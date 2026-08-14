import type { License, Product } from "@prisma/client";

import { issueLicenseCertificate } from "@/lib/certificate";
import {
  buildSignedResponse,
  type LicensePayload,
  type LicenseResponse,
} from "@/lib/license-sign";
import { prisma } from "@/lib/prisma";

export type LicenseWithProduct = License & {
  product: Product;
};

/**
 * Loads a license + product by SHA-256(license key). Returns null if the
 * key is not found.
 *
 * NOTE: the key hash is a lookup credential, never the License identity —
 * License.id is the stable identity (see docs/licentra-offline-migration-spec.md).
 */
export async function loadLicenseByHash(
  keyHash: string
): Promise<LicenseWithProduct | null> {
  const license = await prisma.license.findUnique({
    where: { keyHash },
    include: { product: true },
  });
  if (!license || !license.product) return null;
  return license as LicenseWithProduct;
}

/**
 * Builds the canonical license payload object that gets signed. Key order
 * matters — both server (Node) and clients must produce the same bytes.
 */
export function buildLicensePayload(
  license: LicenseWithProduct
): LicensePayload {
  // `plan` and `expiresAt` were snapshotted onto the License row at
  // issue time (see paddle-webhook.handleTransactionCompleted). They're
  // immutable from the customer's perspective even if the tier's plan
  // name is later edited — that's the point of the snapshot.
  const signedAt = new Date();
  const ttlSeconds = license.product.signatureTtlSeconds;
  return {
    product: license.product.slug,
    plan: license.plan ?? "",
    license_id: license.id,
    license_expires_at: license.expiresAt ? license.expiresAt.toISOString() : null,
    valid_until: new Date(signedAt.getTime() + ttlSeconds * 1000).toISOString(),
  };
}

/**
 * Returns the appropriate signed success response, or an invalid response
 * tagged with the right reason. On success a fresh Signed License
 * Certificate is issued alongside the ECDSA payload — the client stores it
 * locally so it can migrate offline later (spec §5 / §10 / §18).
 */
export async function buildLicenseResponse(
  license: LicenseWithProduct
): Promise<LicenseResponse> {
  if (license.revoked) {
    return {
      valid: false,
      reason:
        license.revokedReason === "refunded"
          ? "license_refunded"
          : "license_revoked",
    };
  }
  if (!license.product.privateKeyEncrypted) {
    // No key configured yet — treat as not-configured-but-valid. The client
    // will fail to verify locally and should fall back to the signed
    // response check, but we surface this so the admin knows to generate
    // a key for the product.
    return { valid: false, reason: "license_revoked" };
  }
  const payload = buildLicensePayload(license);
  const response = buildSignedResponse(payload, license.product.privateKeyEncrypted);
  const certificate = await issueLicenseCertificate(license);
  return { ...response, certificate };
}
