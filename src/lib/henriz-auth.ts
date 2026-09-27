import { env } from "@/lib/env";
import { createHenrizAuthClient, type HenrizAuthClient } from "@/lib/henriz-auth-client";

/**
 * Central SSO (auth.henriz.dev) wiring for Licentra.
 *
 * Pattern A: Licentra is a pure back office, so an unauthenticated visitor to
 * /dashboard is sent straight to the auth login page and comes back to the
 * page they asked for. The legacy email+password+2FA login stays available at
 * /login as a fallback until this is trusted in production.
 *
 * The client secret must only ever live in server-side env vars; this module is
 * server-only.
 */

const TRANSACTION_COOKIE = "__Host-licentra_oauth";

export function henrizSsoEnabled(): boolean {
  return Boolean(
    env.HENRIZ_AUTH_CLIENT_ID &&
      env.HENRIZ_AUTH_CLIENT_SECRET &&
      env.HENRIZ_AUTH_REDIRECT_URI
  );
}

let cached: HenrizAuthClient | undefined;

export function henrizAuth(): HenrizAuthClient {
  const clientId = env.HENRIZ_AUTH_CLIENT_ID;
  const clientSecret = env.HENRIZ_AUTH_CLIENT_SECRET;
  const redirectUri = env.HENRIZ_AUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "henriz SSO is not configured: set HENRIZ_AUTH_CLIENT_ID, HENRIZ_AUTH_CLIENT_SECRET and HENRIZ_AUTH_REDIRECT_URI"
    );
  }
  cached ??= createHenrizAuthClient({
    baseUrl: env.HENRIZ_AUTH_BASE_URL,
    clientId,
    clientSecret,
    redirectUri,
    transactionCookieName: TRANSACTION_COOKIE,
  });
  return cached;
}
