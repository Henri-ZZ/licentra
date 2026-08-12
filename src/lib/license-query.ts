import type { LicenseKey, Product } from "@prisma/client";

import {
  buildSignedResponse,
  type LicensePayload,
  type LicenseResponse,
} from "@/lib/license-sign";
import { prisma } from "@/lib/prisma";

export type LicenseWithProduct = LicenseKey & {
  product: Product;
};

/**
 * Loads a license + product by SHA-256(key). Returns null if the key is
 * not found.
 */
export async function loadLicenseByHash(
  keyHash: string
): Promise<LicenseWithProduct | null> {
  const license = await prisma.licenseKey.findUnique({
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
  return {
    product: license.product.slug,
    plan: license.product.plan,
    license_id: license.id,
    expires_at: null,
  };
}

/**
 * Returns the appropriate signed success response, or an invalid response
 * tagged with the right reason.
 */
export function buildLicenseResponse(
  license: LicenseWithProduct
): LicenseResponse {
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
  return buildSignedResponse(payload, license.product.privateKeyEncrypted);
}
