import { randomBytes } from "node:crypto";

import { decrypt } from "@/lib/crypto";
import {
  CERTIFICATE_ISSUER,
  ed25519Sign,
  ed25519Verify,
  ensureActiveSigningKey,
  licenseStatus,
  type LicenseStatus,
} from "@/lib/certificate";
import { prisma } from "@/lib/prisma";

/**
 * Signed bulk migration export (docs/licentra-offline-migration-spec.md §21).
 *
 * For large migrations Licentra exports ALL License state in one signed
 * document instead of millions of API calls. The document is self-verifying
 * with Licentra's Ed25519 public key — the destination imports it without
 * Licentra being online, and every existing License gets a destination
 * record (users who never come back are still covered, §16).
 *
 * Canonical serialization: Ed25519 signature over JSON.stringify() of the
 * document excluding `signature`, in the fixed field order below.
 */

export const MIGRATION_EXPORT_TYPE = "licentra_license_migration_export";
export const MIGRATION_EXPORT_VERSION = 1 as const;

export interface MigrationExportLicense {
  license_id: string;
  product_id: string;
  plan: string;
  status: LicenseStatus;
  max_devices: number;
  expires_at: string | null;
  created_at: number;
  // Present only when the export opts into customer data (§13 "if needed").
  email?: string | null;
  customer_id?: string | null;
}

export interface MigrationExportUnsigned {
  type: typeof MIGRATION_EXPORT_TYPE;
  version: typeof MIGRATION_EXPORT_VERSION;
  issuer: string;
  export_id: string;
  created_at: number;
  // Destination system this export is prepared for (audit/semantics only,
  // not part of signature-critical verification — but kept in the signed
  // doc so the destination can confirm it is the intended recipient).
  destination_system: string | null;
  licenses: MigrationExportLicense[];
  kid: string;
}

export interface MigrationExport extends MigrationExportUnsigned {
  signature: string;
}

/** Minimal shape of a license needed for export. */
export interface ExportLicenseInput {
  id: string;
  plan: string | null;
  expiresAt: Date | null;
  maxActivations: number;
  revoked: boolean;
  revokedReason: string | null;
  createdAt: Date;
  product: { slug: string };
}

/** Maps a License row to the export record shape (§13 / §21). */
export function toExportLicense(
  license: ExportLicenseInput,
  opts: { includeCustomerData: boolean } = { includeCustomerData: false }
): MigrationExportLicense {
  const record: MigrationExportLicense = {
    license_id: license.id,
    product_id: license.product.slug,
    plan: license.plan ?? "",
    status: licenseStatus(license),
    max_devices: license.maxActivations,
    expires_at: license.expiresAt ? license.expiresAt.toISOString() : null,
    created_at: Math.floor(license.createdAt.getTime() / 1000),
  };
  if (opts.includeCustomerData) {
    record.email = (license as { email?: string | null }).email ?? null;
    record.customer_id = (license as { customerId?: string | null }).customerId ?? null;
  }
  return record;
}

/** Canonical serialization of the signed portion. Field order is frozen. */
export function serializeMigrationExport(
  doc: MigrationExport | MigrationExportUnsigned
): string {
  return JSON.stringify({
    type: doc.type,
    version: doc.version,
    issuer: doc.issuer,
    export_id: doc.export_id,
    created_at: doc.created_at,
    destination_system: doc.destination_system,
    licenses: doc.licenses,
    kid: doc.kid,
  });
}

/** Signs an unsigned export document. */
export function signMigrationExport(
  doc: MigrationExportUnsigned,
  privateKeyPem: string
): MigrationExport {
  const bytes = Buffer.from(serializeMigrationExport(doc), "utf8");
  const signature = ed25519Sign(bytes, privateKeyPem);
  return { ...doc, signature };
}

/** Offline signature check with a known public key. */
export function verifyMigrationExportSignature(
  doc: MigrationExport,
  publicKeyPem: string
): boolean {
  const bytes = Buffer.from(serializeMigrationExport(doc), "utf8");
  return ed25519Verify(bytes, doc.signature, publicKeyPem);
}

export function newExportId(): string {
  return `mig_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}

/**
 * Builds and signs a bulk export using the active Licentra signing key.
 * `licenses` should already be narrowed to what the caller wants to ship
 * (optionally filtered by product / license ids).
 */
export async function createSignedMigrationExport(opts: {
  licenses: ExportLicenseInput[];
  destinationSystem?: string | null;
  exportId?: string;
  includeCustomerData?: boolean;
}): Promise<MigrationExport> {
  const key = await ensureActiveSigningKey();
  const createdAt = new Date();
  const doc: MigrationExportUnsigned = {
    type: MIGRATION_EXPORT_TYPE,
    version: MIGRATION_EXPORT_VERSION,
    issuer: CERTIFICATE_ISSUER,
    export_id: opts.exportId ?? newExportId(),
    created_at: Math.floor(createdAt.getTime() / 1000),
    destination_system: opts.destinationSystem ?? null,
    licenses: opts.licenses.map((l) =>
      toExportLicense(l, { includeCustomerData: opts.includeCustomerData ?? false })
    ),
    kid: key.kid,
  };
  return signMigrationExport(doc, decrypt(key.privateKeyEncrypted));
}

/**
 * Admin-side convenience: load all licenses (optionally filtered) with
 * their product, ready for createSignedMigrationExport.
 */
export async function loadLicensesForExport(opts: {
  productId?: string | null;
  licenseIds?: string[] | null;
} = {}) {
  return prisma.license.findMany({
    where: {
      ...(opts.productId ? { productId: opts.productId } : {}),
      ...(opts.licenseIds?.length ? { id: { in: opts.licenseIds } } : {}),
    },
    include: { product: true },
    orderBy: { createdAt: "asc" },
  });
}
