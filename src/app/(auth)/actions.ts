"use server";

import { redirect } from "next/navigation";

import { createSessionCookie, verifyCredentials } from "@/lib/auth";

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  const ok = await verifyCredentials(email, password);
  if (!ok) {
    return { error: "Invalid email or password" };
  }

  await createSessionCookie(email);
  redirect(next.startsWith("/") ? next : "/dashboard");
}
