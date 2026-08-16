import { NextResponse } from "next/server";

import { clearPending2faCookie, clearSessionCookie } from "@/lib/auth";

export async function POST() {
  await clearSessionCookie();
  await clearPending2faCookie();
  return NextResponse.json({ ok: true });
}
