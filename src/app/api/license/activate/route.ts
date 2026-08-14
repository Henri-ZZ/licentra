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

/**
 * Summarizes a raw User-Agent into a short browser string ("Chrome 126 ·
 * macOS"). The full UA is never stored — only this compact form, which
 * keeps the Activation row small while still recording the user's browser.
 */
function summarizeUserAgent(ua: string): string | null {
  if (!ua || ua.length < 4) return null;
  const browsers: { re: RegExp; name: string }[] = [
    { re: /Edg\/(\d+)/, name: "Edge" },
    { re: /OPR\/(\d+)|Opera\/(\d+)/, name: "Opera" },
    { re: /Firefox\/(\d+)/, name: "Firefox" },
    { re: /Chrome\/(\d+)/, name: "Chrome" },
    { re: /Safari\/(\d+)/, name: "Safari" },
  ];
  let browser = "Unknown";
  for (const { re, name } of browsers) {
    const m = ua.match(re);
    if (m) {
      browser = m[1] ? `${name} ${m[1]}` : name;
      break;
    }
  }
  const osList: [RegExp, string][] = [
    [/Windows NT 10/i, "Windows 10/11"],
    [/Windows NT 6\.3/i, "Windows 8.1"],
    [/Mac OS X/i, "macOS"],
    [/Android/i, "Android"],
    [/iPhone|iPad|iPod/i, "iOS"],
    [/Linux/i, "Linux"],
  ];
  const os = osList.find(([re]) => re.test(ua))?.[1] ?? "?";
  return `${browser} · ${os}`;
}

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
  const browser = summarizeUserAgent(request.headers.get("user-agent") ?? "");

  const result = await prisma.$transaction(async (tx) => {
    const license = await tx.license.findUnique({
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
          browser,
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
        licenseId: license.id,
        fingerprint: fpHash,
        label: parsed.data.label,
        ipAddress,
        browser,
      },
    });

    return license;
  });

  if (!result) {
    return NextResponse.json({ valid: false, reason: "license_not_found" });
  }

  return NextResponse.json(await buildLicenseResponse(result));
}

// Avoid runtime errors when only one fingerprint tries to refresh — the
// transaction logic above already short-circuits before the eviction step.
