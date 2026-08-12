import { redirect } from "next/navigation";

import { getSessionEmail } from "@/lib/auth";

export default async function HomePage() {
  const session = await getSessionEmail();
  redirect(session ? "/dashboard" : "/login");
}