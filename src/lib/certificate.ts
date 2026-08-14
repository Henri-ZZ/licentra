import {
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";

import type { SigningKey } from "@prisma/client";

import { decrypt, encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

/**
 * Signed License Certificate (docs/licentra-offline-migration-spec.md).
 *
 * After a License Key is successfully validated, Licentra issues a Signed
 * License Certificate: an Ed25519-signed snapshot of the License identity
 * and state. The client stores it locally; the destination License system
 * can later verify it OFFLINE using Licentra's public key — no Licentra
 * API call required. This is what makes migration possible after Licentra
 * shuts down.
 *
 *   License Key     ≠  License Identity (License.id)  ≠  Signed Certificate
 *   proves possession    permanent identity             portable proof
 *
 * This is INDEPENDENT from the per-product ECDSA P-256 keys used to sign
 * LicensePayloads for client verification (src/lib/license-sign.ts).
 * Licentra maintains ONE Ed25519 signing key pair (see SigningKey table);
 * the private half is encrypted at rest with LICENSE_MASTER_KEY and never
 * leaves the server.
 *
 * Canonical serialization: the signature is Ed25519 over
 * JSON.stringify() of the payload fields in the fixed order below
 * (signature excluded). Receivers re-serialize the parsed JSON (V8 keeps
 * document key order) and compare — the field order is frozen.
 */

export const CERTIFICATE_ISSUER = "licentra";
export const CERTIFICATE_VERSION = 1 as const;
export const CERTIFICATE_TYPE = "licentra_license_certificate" as const;

export type LicenseStatus = "active" | "expired" | "revoked" | "suspended";

/** Certificate payload WITHOUT the signature (the signed portion). */
export interface LicenseCertificateUnsigned {
  type: typeof CERTIFICATE_TYPE;
  version: typeof CERTIFICATE_VERSION;
  issuer: string;
  kid: string;
  license_id: string;
  product_id: string;
  plan: string;
  status: LicenseStatus;
  max_devices: number;
  // Unix seconds. Spec §23: license_id + issuer + issued_at + kid + nonce
  // give replay protection; the destination keys off license_id.
  issued_at: number;
  // License entitlement expiry (null = lifetime). NOT a certificate TTL —
  // certificates are intentionally long-lived for offline migration (§18).
  expires_at: string | null;
  nonce: string;
}

export interface LicenseCertificate extends LicenseCertificateUnsigned {
  signature: string; // base64 Ed25519 signature
}

/** Minimal shape of a license needed to issue a certificate. */
export interface CertificateLicenseInput {
  id: string;
  plan: string | null;
  expiresAt: Date | null;
  maxActivations: number;
  revoked: boolean;
  revokedReason: string | null;
  product: { slug: string };
}

// ---------------------------------------------------------------------------
// Pure crypto (no DB) — usable by clients, tests and offline tooling
// ---------------------------------------------------------------------------

export function generateEd25519KeyPair(): {
  privateKeyPem: string;
  publicKeyPem: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({
      format: "pem",
      type: "pkcs8",
    }) as string,
    publicKeyPem: publicKey.export({
      format: "pem",
      type: "spki",
    }) as string,
  };
}

/** Derives the spec's License status from the current row. */
export function licenseStatus(license: {
  revoked: boolean;
  revokedReason: string | null;
  expiresAt: Date | null;
}): LicenseStatus {
  if (license.revoked) return "revoked";
  if (license.expiresAt && license.expiresAt.getTime() <= Date.now()) {
    return "expired";
  }
  return "active";
}

/**
 * Canonical serialization of the signed portion. Field order is frozen —
 * changing it breaks verification of already-issued certificates.
 */
export function serializeCertificatePayload(
  cert: LicenseCertificate | LicenseCertificateUnsigned
): string {
  return JSON.stringify({
    type: cert.type,
    version: cert.version,
    issuer: cert.issuer,
    kid: cert.kid,
    license_id: cert.license_id,
    product_id: cert.product_id,
    plan: cert.plan,
    status: cert.status,
    max_devices: cert.max_devices,
    issued_at: cert.issued_at,
    expires_at: cert.expires_at,
    nonce: cert.nonce,
  });
}

/** Builds the unsigned payload with canonical field order. */
export function buildCertificatePayload(
  license: CertificateLicenseInput,
  opts: { kid: string; issuer?: string; issuedAt?: Date }
): LicenseCertificateUnsigned {
  const issuedAt = opts.issuedAt ?? new Date();
  return {
    type: CERTIFICATE_TYPE,
    version: CERTIFICATE_VERSION,
    issuer: opts.issuer ?? CERTIFICATE_ISSUER,
    kid: opts.kid,
    license_id: license.id,
    product_id: license.product.slug,
    plan: license.plan ?? "",
    status: licenseStatus(license),
    max_devices: license.maxActivations,
    issued_at: Math.floor(issuedAt.getTime() / 1000),
    expires_at: license.expiresAt ? license.expiresAt.toISOString() : null,
    nonce: randomBytes(16).toString("hex"),
  };
}

/** Low-level Ed25519 helpers shared by certificates and migration exports. */
export function ed25519Sign(
  bytes: Buffer,
  privateKeyPem: string
): string {
  return cryptoSign(null, bytes, privateKeyPem).toString("base64");
}

export function ed25519Verify(
  bytes: Buffer,
  signatureBase64: string,
  publicKeyPem: string
): boolean {
  return cryptoVerify(
    null,
    bytes,
    createPublicKey(publicKeyPem),
    Buffer.from(signatureBase64, "base64")
  );
}

/** Signs an unsigned payload (or re-signs a certificate). */
export function signCertificate(
  payload: LicenseCertificateUnsigned,
  privateKeyPem: string
): LicenseCertificate {
  const bytes = Buffer.from(serializeCertificatePayload(payload), "utf8");
  const signature = ed25519Sign(bytes, privateKeyPem);
  return { ...payload, signature };
}

/** Offline signature check with a known public key. */
export function verifyCertificateSignature(
  cert: LicenseCertificate | LicenseCertificateUnsigned,
  publicKeyPem: string
): boolean {
  if (!("signature" in cert) || !cert.signature) return false;
  const bytes = Buffer.from(serializeCertificatePayload(cert), "utf8");
  return ed25519Verify(bytes, cert.signature, publicKeyPem);
}

export type CertificateVerificationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "wrong_type"
        | "unsupported_version"
        | "missing_signature"
        | "bad_signature"
        | "expired"
        | "product_mismatch"
        | "bad_status";
    };

/**
 * Full semantic verification (spec §11): signature + version + product
 * binding + status + expiry. `expectedProductId` is the destination
 * product the certificate is being used to prove.
 */
export function verifyCertificateSemantics(
  cert: LicenseCertificate,
  opts: { publicKeyPem: string; expectedProductId: string }
): CertificateVerificationResult {
  if (cert.type !== CERTIFICATE_TYPE) return { ok: false, reason: "wrong_type" };
  if (cert.version !== CERTIFICATE_VERSION) {
    return { ok: false, reason: "unsupported_version" };
  }
  if (cert.product_id !== opts.expectedProductId) {
    return { ok: false, reason: "product_mismatch" };
  }
  if (cert.status === "revoked" || cert.status === "suspended") {
    return { ok: false, reason: "bad_status" };
  }
  if (cert.expires_at && Date.parse(cert.expires_at) <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (!verifyCertificateSignature(cert, opts.publicKeyPem)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Key management (DB-bound)
// ---------------------------------------------------------------------------

/** e.g. "licentra-2026-08". New keys get a numeric suffix on collision. */
function defaultKid(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `licentra-${y}-${m}`;
}

export async function getActiveSigningKey(): Promise<SigningKey | null> {
  return prisma.signingKey.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Returns the active Ed25519 signing key, creating one on first use so a
 * fresh deployment works without manual setup. Kid defaults to the current
 * month; numeric suffix on collision with a retired key of the same month.
 */
export async function ensureActiveSigningKey(): Promise<SigningKey> {
  const existing = await getActiveSigningKey();
  if (existing) return existing;

  const { privateKeyPem, publicKeyPem } = generateEd25519KeyPair();

  let kid = defaultKid();
  let suffix = 2;
  while (await prisma.signingKey.findUnique({ where: { kid } })) {
    kid = `${defaultKid()}-${suffix++}`;
  }

  try {
    return await prisma.signingKey.create({
      data: {
        kid,
        privateKeyEncrypted: encrypt(privateKeyPem),
        publicKey: publicKeyPem,
      },
    });
  } catch (err) {
    // Concurrent bootstrap race: another request created the key first.
    // Reuse it instead of failing the request.
    const winner = await getActiveSigningKey();
    if (winner) return winner;
    throw err;
  }
}

/**
 * Public-key discovery payload for the well-known endpoint. Includes
 * retired keys so previously issued certificates stay verifiable for as
 * long as they may still be presented (§9).
 */
export async function listPublicKeys() {
  const keys = await prisma.signingKey.findMany({
    orderBy: { createdAt: "asc" },
  });
  return keys.map((k) => ({
    kid: k.kid,
    algorithm: k.algorithm,
    public_key: k.publicKey,
    active: k.active,
  }));
}

/**
 * Retires the current active key (kept in the table for verification) and
 * provisions a fresh one. Callers are responsible for authz + audit.
 */
export async function rotateSigningKey(): Promise<SigningKey> {
  await prisma.signingKey.updateMany({
    where: { active: true },
    data: { active: false, retiredAt: new Date() },
  });
  return ensureActiveSigningKey();
}

/**
 * Issues a signed certificate for a license using the active Licentra
 * signing key. This is part of normal license verification: every
 * successful activate/check-in returns a fresh certificate (§10, §18).
 */
export async function issueLicenseCertificate(
  license: CertificateLicenseInput
): Promise<LicenseCertificate> {
  const key = await ensureActiveSigningKey();
  const payload = buildCertificatePayload(license, { kid: key.kid });
  return signCertificate(payload, decrypt(key.privateKeyEncrypted));
}

/**
 * DB-bound offline verification for destination tooling: checks the kid is
 * known to Licentra and the signature verifies (plus semantics). Unknown
 * kid → reject (spec §9: rotation must keep old keys available).
 */
export async function verifyLicenseCertificate(
  cert: LicenseCertificate,
  opts: { expectedProductId: string }
): Promise<CertificateVerificationResult> {
  const key = await prisma.signingKey.findUnique({
    where: { kid: cert.kid },
  });
  if (!key) {
    return { ok: false, reason: "bad_signature" };
  }
  return verifyCertificateSemantics(cert, {
    publicKeyPem: key.publicKey,
    expectedProductId: opts.expectedProductId,
  });
}
