"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LogOut } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inFlight, setInFlight] = useState(false);

  async function onClick() {
    setInFlight(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { redirectTo?: string }
        | null;
      // Central logout must happen in the browser (the SSO session cookie is
      // browser-held), so leave the app instead of router.push("/login") —
      // otherwise the SSO would sign us straight back in.
      if (payload?.redirectTo) {
        window.location.assign(payload.redirectTo);
        return;
      }
      startTransition(() => {
        router.push("/login?loggedOut=1");
        router.refresh();
      });
    } finally {
      setInFlight(false);
    }
  }

  const busy = inFlight || pending;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={busy}
    >
      {busy ? <Spinner /> : <LogOut className="size-4" />}
      Sign out
    </Button>
  );
}