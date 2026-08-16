import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

import { env } from "@/lib/env";

/**
 * Dashboard auth: single hardcoded user, JWT in an httpOnly cookie.
 *
 * The cookie carries a signed JWT containing only the admin email. We never
 * put the password or any sensitive data in the token — verification is
 * done against the env-constant credentials on every request.
 *
 * For v1 there's no User table; switching to a real user model later
 * only requires swapping `verifyCredentials` to a Prisma lookup.
 */

const COOKIE_NAME = "licentra_session";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getJwtSecret(): Uint8Array {
  return new TextEncoder().encode(env.AUTH_JWT_SECRET);
}

export async function verifyCredentials(
  email: string,
  password: string
): Promise<boolean> {
  // Constant-time-ish comparison via the standard library. Both strings are
  // short fixed-shape env values, so this is good enough for a single user.
  if (email.length !== env.ADMIN_EMAIL.length) return false;
  if (password.length !== env.ADMIN_PASSWORD.length) return false;

  const a = Buffer.from(email);
  const b = Buffer.from(env.ADMIN_EMAIL);
  const c = Buffer.from(password);
  const d = Buffer.from(env.ADMIN_PASSWORD);

  // Avoid short-circuit timing leaks: XOR everything, then compare sums.
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  for (let i = 0; i < c.length; i++) diff |= c[i] ^ d[i];
  return diff === 0;
}

export async function createSessionCookie(email: string): Promise<void> {
  const jwt = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${COOKIE_MAX_AGE_SECONDS}s`)
    .sign(getJwtSecret());

  const jar = await cookies();
  jar.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function getSessionEmail(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (typeof payload.email === "string") return payload.email;
    return null;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;

// ---------------------------------------------------------------------------
// Two-factor (TOTP) pending state
//
// After the password step we don't issue the full session yet. Instead we
// set a short-lived "pending" cookie carrying { email, purpose }:
//   purpose "totp"       → a TOTP secret is configured; the client must
//                          submit a 6-digit code to complete login.
//   purpose "totp-setup" → no secret configured yet; the client must go
//                          through /setup-2fa to configure one. The freshly
//                          generated secret travels inside this signed JWT
//                          so the setup page never has to trust client input.
// ---------------------------------------------------------------------------

const PENDING_COOKIE_NAME = "licentra_pending_2fa";
const PENDING_MAX_AGE_SECONDS = 5 * 60; // 5 minutes

export type Pending2faPurpose = "totp" | "totp-setup";

export interface Pending2faState {
  email: string;
  purpose: Pending2faPurpose;
  /** Present only when purpose === "totp-setup". */
  secret?: string;
}

export async function createPending2faCookie(
  email: string,
  purpose: Pending2faPurpose,
  secret?: string
): Promise<void> {
  const jwt = await new SignJWT({
    email,
    purpose,
    ...(secret ? { secret } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${PENDING_MAX_AGE_SECONDS}s`)
    .sign(getJwtSecret());

  const jar = await cookies();
  jar.set(PENDING_COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PENDING_MAX_AGE_SECONDS,
  });
}

export async function getPending2fa(): Promise<Pending2faState | null> {
  const jar = await cookies();
  const token = jar.get(PENDING_COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (typeof payload.email !== "string") return null;
    if (payload.purpose !== "totp" && payload.purpose !== "totp-setup") {
      return null;
    }
    return {
      email: payload.email,
      purpose: payload.purpose,
      secret: typeof payload.secret === "string" ? payload.secret : undefined,
    };
  } catch {
    return null;
  }
}

export async function clearPending2faCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(PENDING_COOKIE_NAME, "", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export const PENDING_2FA_COOKIE_NAME = PENDING_COOKIE_NAME;