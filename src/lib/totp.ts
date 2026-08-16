import { createHmac, randomBytes } from "node:crypto";

import { decrypt, encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

/**
 * TOTP (RFC 6238) helpers for dashboard two-factor authentication.
 *
 * - 6 digits, 30s period, HMAC-SHA1 (the most widely supported combo —
 *   works with 1Password / Authenticator / Authy / etc.).
 * - The secret is a base32 string (RFC 4648, no padding), stored encrypted
 *   at rest in the AppSetting table under "admin_totp_secret".
 * - Verification accepts the current ±1 time step for clock skew.
 */

const SETTING_KEY = "admin_totp_secret";
const DIGITS = 6;
const PERIOD_SECONDS = 30;

// ---------------------------------------------------------------------------
// Base32 (RFC 4648)
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/g, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`invalid base32 char: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

// ---------------------------------------------------------------------------
// TOTP core (RFC 6238)
// ---------------------------------------------------------------------------

/** 20 random bytes → 32-char base32 secret (160 bits of entropy). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secret: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", Buffer.from(base32Decode(secret))).update(buf);
  const digest = hmac.digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** Current 6-digit code for `secret` at time `atMs` (default now). */
export function generateTotp(secret: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
  return hotp(secret, counter);
}

/**
 * Verifies `code` against the current time step ± `window` steps
 * (default 1 → tolerant of ±30s clock skew).
 */
export function verifyTotp(
  secret: string,
  code: string,
  atMs = Date.now(),
  window = 1
): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
  for (let i = -window; i <= window; i++) {
    // Constant-time-ish compare per candidate.
    const expected = hotp(secret, counter + i);
    const a = Buffer.from(expected);
    const b = Buffer.from(code);
    let diff = 0;
    for (let j = 0; j < a.length; j++) diff |= a[j] ^ b[j];
    if (diff === 0) return true;
  }
  return false;
}

/** otpauth:// URI for QR codes / password managers. */
export function totpUri(
  secret: string,
  account: string,
  issuer = "Licentra"
): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Storage (AppSetting, encrypted at rest)
// ---------------------------------------------------------------------------

export async function getTotpSecret(): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({
    where: { key: SETTING_KEY },
  });
  if (!row) return null;
  try {
    return decrypt(row.value);
  } catch {
    return null;
  }
}

export async function setTotpSecret(secret: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: encrypt(secret) },
    update: { value: encrypt(secret) },
  });
}

export async function removeTotpSecret(): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: SETTING_KEY } });
}
