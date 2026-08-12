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
      { error: "invalid_payload" },
      { status: 400 }
    );
  }

  if (!isValidLicenseKeyFormat(parsed.data.key)) {
    return NextResponse.json({ valid: false, reason: "license_not_found" });
  }

  const keyHash = sha256Hex(parsed.data.key);
  const fpHash = sha256Hex(parsed.data.fingerprint);

  const license = await loadLicenseByHash(keyHash);
  if (!license) {
    return NextResponse.json({ valid: false, reason: "license_not_found" });
  }

  // Idempotent: delete if exists, ignore otherwise.
  await prisma.activation.deleteMany({
    where: {
      licenseKeyId: license.id,
      fingerprint: fpHash,
    },
  });

  return NextResponse.json(buildLicenseResponse(license));
}
