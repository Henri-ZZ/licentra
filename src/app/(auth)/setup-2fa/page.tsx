import { redirect } from "next/navigation";
import QRCode from "qrcode";

import { SetupTotpForm } from "@/app/(auth)/setup-totp-form";
import { getPending2fa } from "@/lib/auth";
import { totpUri } from "@/lib/totp";

export default async function Setup2faPage() {
  const pending = await getPending2fa();
  // Only reachable right after a password login when NO secret is
  // configured, within the 5-minute pending window.
  if (!pending || pending.purpose !== "totp-setup" || !pending.secret) {
    redirect("/login");
  }

  const uri = totpUri(pending.secret, pending.email);
  const qrDataUrl = await QRCode.toDataURL(uri, {
    width: 220,
    margin: 1,
    errorCorrectionLevel: "M",
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Set up 2FA</h1>
          <p className="text-sm text-muted-foreground">
            Two-factor authentication is required before you can sign in.
          </p>
        </div>
        <SetupTotpForm
          email={pending.email}
          secret={pending.secret}
          qrDataUrl={qrDataUrl}
        />
      </div>
    </main>
  );
}
