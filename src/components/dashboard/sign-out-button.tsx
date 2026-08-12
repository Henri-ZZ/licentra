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
      await fetch("/api/auth/logout", { method: "POST" });
      startTransition(() => {
        router.push("/login");
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