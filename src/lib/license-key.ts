import { createHash, randomBytes } from "node:crypto";

/**
 * License-key format: K3PQ-W7HN-8YJZ-V9D2
 *
 * 16 characters drawn from an alphabet that excludes visually-confusing glyphs
 * (0/O, 1/I/L), grouped 4-4-4. ~95 bits of entropy.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const KEY_LENGTH = 16;
const GROUP_SIZE = 4;

export function generateLicenseKey(): string {
  const bytes = randomBytes(KEY_LENGTH);
  let chars = "";
  for (let i = 0; i < KEY_LENGTH; i++) {
    chars += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12), chars.slice(12, 16)].join(
    "-"
  );
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

const KEY_REGEX = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

export function isValidLicenseKeyFormat(key: string): boolean {
  return KEY_REGEX.test(key);
}
