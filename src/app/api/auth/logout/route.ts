import { NextResponse, type NextRequest } from "next/server";

import { clearPending2faCookie, clearSessionCookie } from "@/lib/auth";
import { env } from "@/lib/env";

/**
 * Sign out of Licentra **and** the central SSO session.
 *
 * The local cookie alone is not enough: the central session lives in a
 * browser-only cookie on auth.henriz.dev, and the SSO auto-redirect would
 * silently sign the admin straight back in. So we clear the local cookie and
 * hand the browser to auth's RP-initiated logout, which returns to
 * `/login?loggedOut=1` (a terminal page, no auto-redirect).
 *
 * The return URL uses this request's own origin so dev (localhost:3000) and
 * production stay correct; auth only accepts origins of registered clients.
 */
export async function POST(request: NextRequest) {
  await clearSessionCookie();
  await clearPending2faCookie();

  const back = `${request.nextUrl.origin}/login?loggedOut=1`;
  const redirectTo = `${env.HENRIZ_AUTH_BASE_URL}/logout?redirect_uri=${encodeURIComponent(back)}`;

  return NextResponse.json({ ok: true, redirectTo });
}
