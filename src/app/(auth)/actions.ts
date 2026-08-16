"use server";

import { redirect } from "next/navigation";

import {
  clearPending2faCookie,
  createPending2faCookie,
  createSessionCookie,
  getPending2fa,
  verifyCredentials,
} from "@/lib/auth";
import { generateTotpSecret } from "@/lib/totp";
import { getTotpSecret, setTotpSecret, verifyTotp } from "@/lib/totp";

export interface LoginState {
  error?: string;
  /** Password OK + a TOTP secret is configured → show the 6-digit step. */
  needTotp?: boolean;
  /** Password OK + no secret configured → force /setup-2fa. */
  needSetup?: boolean;
  email?: string;
}

export interface TotpState {
  error?: string;
}

function safeNext(value: string): string {
  return value.startsWith("/") ? value : "/dashboard";
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const ok = await verifyCredentials(email, password);
  if (!ok) {
    return { error: "Invalid email or password" };
  }

  const secret = await getTotpSecret();
  if (secret) {
    await createPending2faCookie(email, "totp");
    return { needTotp: true, email };
  }

  // No secret configured → force setup before granting a session.
  await createPending2faCookie(email, "totp-setup", generateTotpSecret());
  return { needSetup: true };
}

export async function verifyTotpAction(
  _prev: TotpState,
  formData: FormData
): Promise<TotpState> {
  const code = String(formData.get("code") ?? "").trim();
  const next = safeNext(String(formData.get("next") ?? "/dashboard"));

  const pending = await getPending2fa();
  if (!pending || pending.purpose !== "totp") {
    redirect("/login");
  }
  const secret = await getTotpSecret();
  if (!secret || !verifyTotp(secret, code)) {
    return { error: "Invalid or expired code" };
  }

  await createSessionCookie(pending.email);
  await clearPending2faCookie();
  redirect(next);
}

export async function confirmTotpSetupAction(
  _prev: TotpState,
  formData: FormData
): Promise<TotpState> {
  const code = String(formData.get("code") ?? "").trim();

  const pending = await getPending2fa();
  // Secret is read from the signed pending cookie — never from client input.
  if (!pending || pending.purpose !== "totp-setup" || !pending.secret) {
    redirect("/login");
  }
  if (!verifyTotp(pending.secret, code)) {
    return { error: "Invalid code — check the code in your authenticator" };
  }

  await setTotpSecret(pending.secret);
  await createSessionCookie(pending.email);
  await clearPending2faCookie();
  redirect("/dashboard");
}
