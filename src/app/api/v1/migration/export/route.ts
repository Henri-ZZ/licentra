import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSessionEmail } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import {
  createSignedMigrationExport,
  loadLicensesForExport,
} from "@/lib/migration-export";
import { clientIp, rateLimitByIp } from "@/lib/rate-limit";

const bodySchema = z.object({
  // Optional filters — omit to export ALL licenses.
  productId: z.string().min(1).optional(),
  licenseIds: z.array(z.string().min(1)).max(10000).optional(),
  // Destination system this export is prepared for (audit + signed doc).
  destinationSystem: z.string().max(120).optional(),
  // Include email / customer_id per license (spec §13 "if needed").
  includeCustomerData: z.boolean().optional().default(false),
  // Caller-provided id groups this export; auto-generated when omitted.
  migrationId: z.string().max(200).optional(),
});

/**
 * Signed bulk migration export (spec §13 Part A / §21).
 *
 * Creates ONE Ed25519-signed document containing the selected License
 * state (identity, product, plan, status, max_devices, expiry, created_at
 * — never plaintext keys or private signing keys). The destination imports
 * it offline and can keep working after Licentra shuts down.
 *
 * Security (spec §22): admin session required, per-IP rate limiting,
 * full audit trail, no plaintext/private data in responses or logs.
 * SameSite=Lax on the session cookie provides baseline CSRF protection.
 */
export async function POST(request: NextRequest) {
  const session = await getSessionEmail();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rl = rateLimitByIp(clientIp(request), {
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: rl.retryAfterSeconds },
      { status: 429 }
    );
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine — exports everything */
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const licenses = await loadLicensesForExport({
    productId: parsed.data.productId ?? null,
    licenseIds: parsed.data.licenseIds ?? null,
  });
  if (licenses.length === 0) {
    return NextResponse.json({ error: "no_licenses" }, { status: 404 });
  }

  const migrationId =
    parsed.data.migrationId ?? `mig_${Date.now().toString(36)}`;
  const doc = await createSignedMigrationExport({
    licenses,
    destinationSystem: parsed.data.destinationSystem ?? null,
    includeCustomerData: parsed.data.includeCustomerData,
    exportId: migrationId,
  });

  // Audit (spec §26): a single export event. The signed export document
  // itself is the authoritative per-license record — no N+1 audit rows.
  await recordAudit({
    eventType: "license.migration_exported",
    migrationId,
    destinationSystem: doc.destination_system,
    actor: session,
    metadata: {
      licenseCount: doc.licenses.length,
      kid: doc.kid,
      productId: parsed.data.productId ?? null,
    },
  });

  return NextResponse.json(doc);
}
