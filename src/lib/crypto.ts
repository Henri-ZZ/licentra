import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { env } from "@/lib/env";

/**
 * AES-256-GCM helpers used to encrypt product private keys at rest.
 *
 * The master key (LICENSE_MASTER_KEY) is read from env and expected to be
 * 32 bytes expressed as 64 hex characters. We treat the input as opaque
 * bytes — never log keys or ciphertexts together.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits, GCM-recommended
const AUTH_TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  const hex = env.LICENSE_MASTER_KEY;
  if (hex.length !== 64) {
    throw new Error("LICENSE_MASTER_KEY must be 32-byte hex (64 chars)");
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypts a UTF-8 string (e.g., a PEM private key) and returns
 * base64-encoded ciphertext in the format `iv:authTag:ciphertext`.
 */
export function encrypt(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypts a payload previously produced by `encrypt`.
 */
export function decrypt(payload: string): string {
  const key = getMasterKey();
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("invalid ciphertext format");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}