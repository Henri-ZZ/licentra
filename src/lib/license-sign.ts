import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";

import type { LicenseCertificate } from "@/lib/certificate";
import { decrypt } from "@/lib/crypto";

/**
 * License payload signed with the product's ECDSA P-256 private key.
 *
 * The on-the-wire shape matches what clients embed in their apps:
 *
 *   {
 *     "valid": true,
 *     "payload": {
 *       "product": "stealth-browser-assistant",
 *       "plan": "pro",
 *       "license_id": "abc123",
 *       "license_expires_at": null,
 *       "valid_until": "2026-08-14T16:00:00.000Z"
 *     },
 *     "signature": "MEUCIQ..."
 *   }
 *
 * Serialisation is plain JSON.stringify(payload) — both the server (Node)
 * and clients (V8/browser) emit keys in insertion order. The order below is
 * frozen; do not reorder fields without a coordinated client rollout.
 */
export interface LicensePayload {
  product: string;
  plan: string;
  license_id: string;
  // When the license entitlement itself expires (null = lifetime). This is
  // the business-level subscription expiry — NOT the signature freshness
  // window (that's `valid_until`).
  license_expires_at: string | null;
  // Signature valid-until (ISO) = issue time + product.signatureTtlSeconds.
  // The client verifies the signature, then checks `now < valid_until`;
  // once past it, it must go back online to re-verify (so refunds /
  // revocations take effect).
  valid_until: string;
}

export interface LicenseSignedResponse {
  valid: true;
  payload: LicensePayload;
  signature: string;
  // Signed License Certificate (Ed25519, Licentra-level) issued alongside
  // the ECDSA payload so the client can later migrate offline (spec §5/§10).
  // Present on activate/check-in success responses.
  certificate?: LicenseCertificate;
}

export interface LicenseInvalidResponse {
  valid: false;
  reason:
    | "license_not_found"
    | "license_revoked"
    | "license_refunded"
    | "activation_evicted";
}

export type LicenseResponse = LicenseSignedResponse | LicenseInvalidResponse;

/**
 * Generates a fresh ECDSA P-256 key pair. Returns PEM-encoded private and
 * public keys suitable for storage (encrypt the private) and client
 * distribution (give the public to the product owner).
 */
export function generateKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1", // aka P-256 / secp256r1
  });
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }) as string,
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }) as string,
  };
}

/**
 * Signs a license payload with the product's private key (PEM, already
 * decrypted from storage). Returns a base64 DER-encoded ECDSA signature.
 *
 * Algorithm: ECDSA over SHA-256. Node emits DER automatically for ECDSA,
 * which is what we want — clients in the wild expect MEUCIQ... prefixes.
 */
export function signPayload(
  payload: LicensePayload,
  privateKeyPem: string
): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const sig = cryptoSign("sha256", payloadBytes, privateKeyPem);
  return sig.toString("base64");
}

/**
 * Verifies a license signature on the client-side reference path. We don't
 * call this from the server, but expose it for tooling and tests.
 */
export function verifyPayload(
  payload: LicensePayload,
  signatureBase64: string,
  publicKeyPem: string
): boolean {
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const sigBytes = Buffer.from(signatureBase64, "base64");
  return cryptoVerify(
    "sha256",
    payloadBytes,
    createPublicKey(publicKeyPem),
    sigBytes
  );
}

/**
 * Decrypts the encrypted private key blob stored on a Product row and
 * returns the PEM private key ready for signing.
 */
export function loadPrivateKey(privateKeyEncrypted: string): string {
  return decrypt(privateKeyEncrypted);
}

/**
 * Convenience: build a signed success response.
 */
export function buildSignedResponse(
  payload: LicensePayload,
  privateKeyEncrypted: string
): LicenseSignedResponse {
  const privateKeyPem = loadPrivateKey(privateKeyEncrypted);
  return {
    valid: true,
    payload,
    signature: signPayload(payload, privateKeyPem),
  };
}
