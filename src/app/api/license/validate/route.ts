import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  buildLicenseResponse,
  loadLicenseByHash,
} from "@/lib/license-query";
import { sha256Hex, isValidLicenseKeyFormat } from "@/lib/license-key";

const bodySchema = z.object({
  key: z.string().min(1),
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

  const license = await loadLicenseByHash(sha256Hex(parsed.data.key));
  if (!license) {
    return NextResponse.json({ valid: false, reason: "license_not_found" });
  }

  return NextResponse.json(buildLicenseResponse(license));
}
