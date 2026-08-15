"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Product } from "@prisma/client";

export function ProductEditForm({ product }: { product: Product }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInFlight(true);
    try {
      const fd = new FormData(e.currentTarget);
      const payload = {
        name: String(fd.get("name") ?? ""),
        description: String(fd.get("description") ?? "") || null,
        paddleProductId: String(fd.get("paddleProductId") ?? "") || null,
        maxActivations: Number(fd.get("maxActivations") ?? 3),
        signatureTtlSeconds: Number(fd.get("signatureTtlSeconds") ?? 86400),
        active: fd.get("active") === "on",
        supportEmail: String(fd.get("supportEmail") ?? "") || null,
        // plan / priceId live on PriceTier rows now — managed in the
        // "Price tiers" card below. See docs/plans/price-tiers.md.
      };
      const res = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Error ${res.status}`);
        return;
      }
      toast.success("Saved");
      startTransition(() => router.refresh());
    } finally {
      setInFlight(false);
    }
  }

  const busy = inFlight || pending;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" defaultValue={product.name} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="paddleProductId">Paddle product ID</Label>
          <Input
            id="paddleProductId"
            name="paddleProductId"
            defaultValue={product.paddleProductId ?? ""}
            placeholder="pro_xxx"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          name="description"
          defaultValue={product.description ?? ""}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="maxActivations">Max activations</Label>
          <Input
            id="maxActivations"
            name="maxActivations"
            type="number"
            min={1}
            max={100}
            defaultValue={product.maxActivations}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="signatureTtlSeconds">
            Signature validity (seconds)
          </Label>
          <Input
            id="signatureTtlSeconds"
            name="signatureTtlSeconds"
            type="number"
            min={60}
            defaultValue={product.signatureTtlSeconds}
          />
          <p className="text-xs text-muted-foreground">
            How long a signed payload stays valid offline. 86400 = 24h.
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Status</Label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="active"
            defaultChecked={product.active}
          />
          <span>Active and selling</span>
        </label>
      </div>

      <div className="space-y-2 border-t pt-4">
        <Label htmlFor="supportEmail">Support email</Label>
        <Input
          id="supportEmail"
          name="supportEmail"
          type="email"
          defaultValue={product.supportEmail ?? ""}
          placeholder="support@mail.henri.ren"
        />
        <p className="text-xs text-muted-foreground">
          Substituted into{" "}
          <code className="font-mono">{`{{supportEmail}}`}</code> at send time.
          Falls back to <code>SUPPORT_EMAIL</code> from env when empty.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy && <Spinner />}
        {busy ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
