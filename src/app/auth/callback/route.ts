import { NextResponse, type NextRequest } from "next/server";

import { createSessionCookie } from "@/lib/auth";
import { env } from "@/lib/env";
import { henrizAuth, henrizSsoEnabled } from "@/lib/henriz-auth";

export const runtime = "nodejs";

/**
 * Central SSO callback.
 *
 * Exchanges the one-time code server-to-server (PKCE verifier travels only
 * between the transaction cookie and auth.henriz.dev), then mints the same
 * `licentra_session` JWT the password login issues — so every existing
 * /dashboard guard keeps working untouched. The central `sub` and
 * `auth_method` ride along in the JWT for auditing.
 */
export async function GET(request: NextRequest) {
  if (!henrizSsoEnabled()) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const auth = henrizAuth();
  const result = await auth.completeLogin({
    code: request.nextUrl.searchParams.get("code"),
    state: request.nextUrl.searchParams.get("state"),
    transaction: request.cookies.get(auth.transactionCookieName)?.value,
  });

  if (!result.ok) {
    // A code is single-use: never retry it, always start a new round trip.
    const retry = NextResponse.redirect(new URL("/login?error=sso", request.url));
    const cleared = auth.clearTransaction();
    retry.cookies.set(cleared.name, cleared.value, cleared.options);
    return retry;
  }

  await createSessionCookie(env.ADMIN_EMAIL, {
    sub: result.claims.sub,
    authMethod: result.claims.auth_method,
  });

  const response = NextResponse.redirect(new URL(result.returnTo, request.url), {
    status: 303,
  });
  const cleared = auth.clearTransaction();
  response.cookies.set(cleared.name, cleared.value, cleared.options);
  return response;
}
