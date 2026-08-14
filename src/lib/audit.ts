import { prisma } from "@/lib/prisma";

/**
 * License lifecycle / migration audit trail (spec §26).
 *
 * Event types (spec):
 *   license.migration_certificate_issued — a certificate was issued to a
 *     migration consumer (bulk export path; normal activate/check-in is
 *     too hot to audit every response).
 *   license.migration_exported          — a signed bulk export was created.
 *   license.key_rotated                 — a License Key was rotated in place.
 *   license.status_changed              — revoked / refunded / etc.
 *
 * NEVER log plaintext License Keys, private signing keys, or auth secrets.
 */

export type AuditEventType =
  | "license.migration_certificate_issued"
  | "license.migration_exported"
  | "license.key_rotated"
  | "license.status_changed";

export interface RecordAuditParams {
  eventType: AuditEventType;
  licenseId?: string | null;
  sourceSystem?: string | null;
  sourceLicenseId?: string | null;
  destinationSystem?: string | null;
  migrationId?: string | null;
  actor?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function recordAudit(p: RecordAuditParams): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        eventType: p.eventType,
        licenseId: p.licenseId ?? null,
        sourceSystem: p.sourceSystem ?? null,
        sourceLicenseId: p.sourceLicenseId ?? null,
        destinationSystem: p.destinationSystem ?? null,
        migrationId: p.migrationId ?? null,
        actor: p.actor ?? null,
        metadata: (p.metadata as object | null) ?? undefined,
      },
    });
  } catch (err) {
    // Audit must never take down the primary operation.
    console.error("[audit] failed to record event:", err);
  }
}

/**
 * Batch variant for bulk operations (e.g. per-license certificate issuance
 * inside a large migration export). Skips entries missing eventType.
 */
export async function recordAuditMany(
  entries: RecordAuditParams[]
): Promise<void> {
  if (entries.length === 0) return;
  try {
    await prisma.auditEvent.createMany({
      data: entries.map((p) => ({
        eventType: p.eventType,
        licenseId: p.licenseId ?? null,
        sourceSystem: p.sourceSystem ?? null,
        sourceLicenseId: p.sourceLicenseId ?? null,
        destinationSystem: p.destinationSystem ?? null,
        migrationId: p.migrationId ?? null,
        actor: p.actor ?? null,
        metadata: (p.metadata as object | null) ?? undefined,
      })),
    });
  } catch (err) {
    console.error("[audit] failed to record batch event:", err);
  }
}
