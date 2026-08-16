"use client";

import { useActionState } from "react";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  confirmTotpSetupAction,
  type TotpState,
} from "@/app/(auth)/actions";

export function SetupTotpForm({
  email,
  secret,
  qrDataUrl,
}: {
  email: string;
  secret: string;
  qrDataUrl: string;
}) {
  const [state, formAction, pending] = useActionState<TotpState, FormData>(
    confirmTotpSetupAction,
    {}
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scan with your authenticator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt="TOTP QR code"
            className="rounded-md border"
            width={220}
            height={220}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Or enter this secret manually</Label>
          <Input
            readOnly
            value={secret}
            className="text-center font-mono text-sm tracking-wider"
            onFocus={(e) => e.target.select()}
          />
          <p className="text-xs text-muted-foreground">
            Account: {email} · Issuer: Licentra
          </p>
        </div>

        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="setup-code">6-digit code</Label>
            <Input
              id="setup-code"
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
              Enter the code shown in your authenticator to confirm setup.
            </p>
          </div>
          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Spinner />}
            {pending ? "Verifying…" : "Confirm & continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
