import { prisma } from "@/lib/prisma";

/**
 * License lifecycle / migration audit trail (spec §26).
 *
 * Event types:
 *   license.migration_exported — a signed bulk export was created (one row
 *     per export; the signed document itself is the per-license record).
 *   license.key_rotated        — a License Key was rotated in place.
 *   license.status_changed     — revoked / refunded / etc.
 *
 * NEVER log plaintext License Keys, private signing keys, or auth secrets.
 */

export type AuditEventType =
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
