import { NextResponse } from "next/server";

/**
 * Legacy `POST /api/auth/login` (email + password → session cookie).
 *
 * Disabled: Licentra now signs in exclusively through central SSO
 * (auth.henriz.dev) — see `src/app/auth/login/route.ts` and
 * auth-henriz-dev/docs/SSO_INTEGRATION.md. The original implementation is kept
 * below in a comment so a rollback is a single uncomment.
 */
export async function POST() {
  return NextResponse.json(
    { error: "password_login_disabled" },
    { status: 410 }
  );
}

/*
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createSessionCookie, verifyCredentials } from "@/lib/auth";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json" },
      { status: 400 }
    );
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const ok = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!ok) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  await createSessionCookie(parsed.data.email);

  return NextResponse.json({ ok: true });
}
*/
