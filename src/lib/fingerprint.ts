import { createHash, createPrivateKey, createPublicKey } from "node:crypto";

/**
 * SHA-256 hashing helper. Used to derive a stable fingerprint from raw
 * device identifiers before persisting them, so the DB never stores the
 * raw fingerprint value.
 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Compute a stable fingerprint of a public key for human-readable
 * identification. We hash the DER encoding of the SPKI structure.
 */
export function publicKeyFingerprint(publicKeyPem: string): string {
  const keyObj = createPublicKey(publicKeyPem);
  const der = keyObj.export({ format: "der", type: "spki" });
  return createHash("sha256").update(der).digest("hex").slice(0, 32);
}

/**
 * Compute a stable fingerprint of a private key, used as a sanity check
 * when we need to confirm we have the right key without exposing it.
 */
export function privateKeyFingerprint(privateKeyPem: string): string {
  const keyObj = createPrivateKey(privateKeyPem);
  const der = keyObj.export({ format: "der", type: "pkcs8" });
  return createHash("sha256").update(der).digest("hex").slice(0, 32);
}
