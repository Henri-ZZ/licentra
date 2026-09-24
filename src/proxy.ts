import { NextResponse, type NextRequest } from "next/server";

import { PENDING_2FA_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/lib/auth";

// ───────────────────────── license API CORS ─────────────────────────
//
// The Edit Page browser extension calls /api/license/* straight from its
// extension origin. It intentionally holds no host permission for this API,
// so the calls are ordinary CORS requests and need the headers below.
//
// Only browser-extension origins are reflected: the endpoints stay
// unreachable from regular websites, and no credentials are involved.
// Requests without an Origin header (curl, server-to-server) are untouched.
const EXTENSION_ORIGIN_PATTERN =
  /^(?:(?:chrome|moz|safari-web)-extension|extension):\/\/[a-z0-9._-]+$/i;

const LICENSE_API_PREFIX = "/api/license";

const LICENSE_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function resolveExtensionOrigin(request: NextRequest): string | null {
  const origin = request.headers.get("origin");
  return origin && EXTENSION_ORIGIN_PATTERN.test(origin) ? origin : null;
}

/**
 * Answers CORS for the public license endpoints. Returns null when the
 * request does not target them, so the caller keeps its normal flow.
 */
function handleLicenseCors(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  const isLicenseApi =
    pathname === LICENSE_API_PREFIX ||
    pathname.startsWith(`${LICENSE_API_PREFIX}/`);
  if (!isLicenseApi) return null;

  const origin = resolveExtensionOrigin(request);

  // Preflight: answer directly — the route handlers only export POST.
  if (request.method === "OPTIONS") {
    const response = new NextResponse(null, { status: 204 });
    response.headers.set("Vary", "Origin");
    for (const [name, value] of Object.entries(LICENSE_CORS_HEADERS)) {
      response.headers.set(name, value);
    }
    if (origin) {
      response.headers.set("Access-Control-Allow-Origin", origin);
    }
    return response;
  }

  const response = NextResponse.next();
  // The response body depends on Origin, so caches must not share it.
  response.headers.set("Vary", "Origin");
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }
  return response;
}

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`. We use it to guard the
 * /dashboard tree (full session required) and the /setup-2fa page (pending
 * 2FA-setup cookie required), and to answer CORS for the public license API
 * so browser extensions can call it without holding a host permission.
 * Anything else — login, public pages, webhook — flows through untouched.
 *
 * The proxy only checks cookie PRESENCE; the authoritative checks (JWT
 * validity, purpose, expiry) happen in the pages/routes themselves.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const licenseCors = handleLicenseCors(request);
  if (licenseCors) {
    return licenseCors;
  }

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
  matcher: ["/dashboard/:path*", "/setup-2fa", "/api/license/:path*"],
};
