"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";

export function LicenseRowActions({
  licenseId,
  revoked,
}: {
  licenseId: string;
  revoked: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"revoke" | "resend" | null>(null);

  async function revoke() {
    if (!confirm("Revoke this license? This cannot be undone.")) return;
    setBusy("revoke");
    const reason = prompt("Optional reason:", "admin_action") ?? undefined;
    try {
      const res = await fetch(`/api/licenses/${licenseId}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        toast.error(`Failed to revoke (${res.status})`);
        return;
      }
      toast.success("License revoked");
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  async function resend() {
    setBusy("resend");
    try {
      const res = await fetch(`/api/licenses/${licenseId}/resend-email`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(`Failed to resend: ${body.error ?? res.status}`);
        return;
      }
      toast.success("Email sent (old license revoked, new key generated)");
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  const disabled = pending || busy !== null;

  return (
    <div className="flex justify-end gap-2">
      {!revoked && (
        <Button
          variant="outline"
          size="sm"
          onClick={resend}
          disabled={disabled}
        >
          {busy === "resend" && <Spinner />}
          {busy === "resend" ? "Sending…" : "Resend email"}
        </Button>
      )}
      {!revoked && (
        <Button
          variant="destructive"
          size="sm"
          onClick={revoke}
          disabled={disabled}
        >
          {busy === "revoke" && <Spinner />}
          {busy === "revoke" ? "Revoking…" : "Revoke"}
        </Button>
      )}
    </div>
  );
}