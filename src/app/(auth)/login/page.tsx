import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionEmail } from "@/lib/auth";
import { henrizSsoEnabled } from "@/lib/henriz-auth";
// Legacy email + password + TOTP form — hidden in favour of central SSO.
// Uncomment together with the actions in ./actions.ts to roll back.
// import { LoginForm } from "@/app/(auth)/login-form";

interface LoginPageProps {
  searchParams: Promise<{ next?: string; error?: string; loggedOut?: string }>;
}

function safeNext(value: string | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/dashboard";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  if (await getSessionEmail()) redirect("/dashboard");

  const sp = await searchParams;
  const ssoEntry = `/auth/login?returnTo=${encodeURIComponent(safeNext(sp.next))}`;

  // Central SSO is the only way in: this page just forwards to it. A failed
  // callback / a finished sign-out lands here with a message instead of another
  // redirect, otherwise the two pages would bounce forever.
  if (henrizSsoEnabled() && !sp.error && !sp.loggedOut) redirect(ssoEntry);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            {sp.error
              ? "Sign-in failed"
              : sp.loggedOut
                ? "Signed out"
                : "Central SSO not configured"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {sp.error
              ? "The central login could not be completed. Start over to try again."
              : sp.loggedOut
                ? "You have been signed out of the central login. Sign in again to continue."
                : "This deployment has no henriz-auth client configured, so there is no way to sign in."}
          </p>
          {henrizSsoEnabled() && (
            <Button asChild className="w-full">
              <Link href={ssoEntry}>Sign in with henriz-auth</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
