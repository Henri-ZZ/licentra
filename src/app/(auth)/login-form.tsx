"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  loginAction,
  verifyTotpAction,
  type LoginState,
  type TotpState,
} from "@/app/(auth)/actions";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    {}
  );
  const [totpState, totpAction, totpPending] = useActionState<
    TotpState,
    FormData
  >(verifyTotpAction, {});

  // Password OK but no TOTP configured → force the setup flow.
  useEffect(() => {
    if (state.needSetup) {
      router.push("/setup-2fa");
    }
  }, [state.needSetup, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{state.needTotp ? "Two-factor code" : "Sign in"}</CardTitle>
      </CardHeader>
      <CardContent>
        {state.needTotp ? (
          <form action={totpAction} className="space-y-4">
            <input type="hidden" name="next" value={next} />
            <div className="space-y-2">
              <Label htmlFor="code">6-digit code</Label>
              <Input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                maxLength={6}
                className="text-center font-mono text-lg tracking-[0.5em]"
                placeholder="••••••"
              />
              <p className="text-xs text-muted-foreground">
                Enter the code from your authenticator app for {state.email}.
              </p>
            </div>
            {totpState.error && (
              <p className="text-sm text-destructive">{totpState.error}</p>
            )}
            <Button type="submit" className="w-full" disabled={totpPending}>
              {totpPending && <Spinner />}
              {totpPending ? "Verifying…" : "Verify"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => router.push("/login")}
            >
              Back
            </Button>
          </form>
        ) : (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="next" value={next} />
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                defaultValue=""
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {state.error && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending && <Spinner />}
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
