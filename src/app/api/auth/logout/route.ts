import { NextResponse } from "next/server";

import { clearPending2faCookie, clearSessionCookie } from "@/lib/auth";
import { env } from "@/lib/env";

/**
 * Sign out of Licentra **and** the central SSO session.
 *
 * The local cookie alone is not enough: the central session lives in a
 * browser-only cookie on auth.henriz.dev, and the SSO auto-redirect would
 * silently sign the admin straight back in. So we clear the local cookie and
 * hand the browser to auth's logout page, which confirms, revokes the central
 * session and shows its own "signed out" screen. We deliberately do not return
 * here — /login would bounce straight into a new SSO round trip.
 */
export async function POST() {
  await clearSessionCookie();
  await clearPending2faCookie();

  return NextResponse.json({ ok: true, redirectTo: `${env.HENRIZ_AUTH_BASE_URL}/logout` });
}
