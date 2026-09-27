import { NextResponse, type NextRequest } from "next/server";

import { henrizAuth, henrizSsoEnabled } from "@/lib/henriz-auth";

export const runtime = "nodejs";

/**
 * Central SSO entry point (pattern A: pure back office).
 *
 * /dashboard sends unauthenticated visitors here with `returnTo`, we hand them
 * to auth.henriz.dev with a fresh state + PKCE challenge, and /auth/callback
 * brings them back. When the SSO env vars are missing we fall back to the
 * legacy /login form so a half-configured deployment can never lock anyone out.
 */
export async function GET(request: NextRequest) {
  const returnTo = request.nextUrl.searchParams.get("returnTo");

  if (!henrizSsoEnabled()) {
    const fallback = new URL("/login", request.url);
    fallback.searchParams.set("next", returnTo ?? "/dashboard");
    return NextResponse.redirect(fallback);
  }

  const { authorizeUrl, cookie } = henrizAuth().beginLogin(returnTo ?? "/dashboard");
  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
