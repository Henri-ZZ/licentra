"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";

interface Props {
  productId: string;
  hasExistingKey: boolean;
}

/**
 * Generates (or regenerates) the product's ECDSA P-256 signing key pair.
 * Hits POST /api/products/:id/generate-key and refreshes the page so the
 * new public key fingerprint is visible.
 */
export function GenerateKeyButton({ productId, hasExistingKey }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setInFlight(true);
    try {
      const res = await fetch(`/api/products/${productId}/generate-key`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Error ${res.status}`);
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setInFlight(false);
    }
  }

  const busy = inFlight || pending;

  return (
    <div className="space-y-2">
      <Button onClick={onClick} disabled={busy}>
        {busy && <Spinner />}
        {busy
          ? hasExistingKey
            ? "Regenerating…"
            : "Generating…"
          : hasExistingKey
            ? "Regenerate key pair"
            : "Generate key pair"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}