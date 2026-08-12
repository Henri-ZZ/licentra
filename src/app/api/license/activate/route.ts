import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  buildLicenseResponse,
  loadLicenseByHash,
} from "@/lib/license-query";
import { sha256Hex, isValidLicenseKeyFormat } from "@/lib/license-key";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  key: z.string().min(1),
  fingerprint: z.string().min(1),
  label: z.string().max(120).optional(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  if (!isValidLicenseKeyFormat(parsed.data.key)) {
    return NextResponse.json({ valid: false, reason: "license_not_found" });
  }

  const keyHash = sha256Hex(parsed.data.key);
  const fpHash = sha256Hex(parsed.data.fingerprint);
  const ipAddress = request.headers.get("x-forwarded-for") ?? "";
  const userAgent = request.headers.get("user-agent") ?? "";

  const result = await prisma.$transaction(async (tx) => {
    const license = await tx.licenseKey.findUnique({
      where: { keyHash },
      include: {
        product: true,
        activations: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!license || !license.product) return null;

    // 1) Same fingerprint already bound: refresh lastCheckedAt.
    const existing = license.activations.find((a) => a.fingerprint === fpHash);
    if (existing) {
      await tx.activation.update({
        where: { id: existing.id },
        data: {
          lastCheckedAt: new Date(),
          label: parsed.data.label ?? existing.label,
          ipAddress,
          userAgent,
        },
      });
      return license;
    }

    // 2) New fingerprint: if at cap, evict the oldest existing activation.
    if (license.activations.length >= license.maxActivations) {
      const earliest = license.activations[0];
      await tx.activation.delete({ where: { id: earliest.id } });
    }

    // 3) Register the new activation.
    await tx.activation.create({
      data: {
        licenseKeyId: license.id,
        fingerprint: fpHash,
        label: parsed.data.label,
        ipAddress,
        userAgent,
      },
    });

    return license;
  });

  if (!result) {
    return NextResponse.json({ valid: false, reason: "license_not_found" });
  }

  return NextResponse.json(buildLicenseResponse(result));
}

// Avoid runtime errors when only one fingerprint tries to refresh — the
// transaction logic above already short-circuits before the eviction step.
