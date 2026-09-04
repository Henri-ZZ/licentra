"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Re-runs the current server component so the licenses list picks up new
 * licenses and fresh activation / email state without a full page reload.
 */
export function LicensesRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RefreshCw className={pending ? "animate-spin" : undefined} />
      {pending ? "Refreshing…" : "Refresh"}
    </Button>
  );
}
