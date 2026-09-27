import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/(auth)/login-form";
import { getSessionEmail } from "@/lib/auth";
import { henrizSsoEnabled } from "@/lib/henriz-auth";

interface LoginPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getSessionEmail();
  if (session) redirect("/dashboard");

  const sp = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Licentra</h1>
          <p className="text-sm text-muted-foreground">Sign in to your dashboard</p>
        </div>
        <LoginForm next={sp.next ?? "/dashboard"} />
        {henrizSsoEnabled() && (
          <p className="text-center text-xs text-muted-foreground">
            Central SSO enabled ·{" "}
            <Link
              className="underline underline-offset-2"
              href={`/auth/login?returnTo=${encodeURIComponent(
                sp.next ?? "/dashboard"
              )}`}
            >
              sign in with henriz-auth
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
