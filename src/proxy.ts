import { NextResponse, type NextRequest } from "next/server";

import { PENDING_2FA_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/lib/auth";

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`. We use it to guard the
 * /dashboard tree (full session required) and the /setup-2fa page (pending
 * 2FA-setup cookie required). Anything else — login, public pages, license
 * API, webhook — flows through untouched.
 *
 * The proxy only checks cookie PRESENCE; the authoritative checks (JWT
 * validity, purpose, expiry) happen in the pages/routes themselves.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/dashboard")) {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (token) {
      return NextResponse.next();
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/setup-2fa") {
    const pending = request.cookies.get(PENDING_2FA_COOKIE_NAME)?.value;
    if (pending) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/setup-2fa"],
};
