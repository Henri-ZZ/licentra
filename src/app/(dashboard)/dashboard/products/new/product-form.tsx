"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProductForm() {
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
      const tierPlan = String(fd.get("tierPlan") ?? "").trim();
      const tierPriceId = String(fd.get("tierPaddlePriceId") ?? "").trim();

      const payload: Record<string, unknown> = {
        name: String(fd.get("name") ?? ""),
        slug: String(fd.get("slug") ?? ""),
        description: String(fd.get("description") ?? "") || null,
        paddleProductId: String(fd.get("paddleProductId") ?? "") || null,
        maxActivations: Number(fd.get("maxActivations") ?? 3),
        active: fd.get("active") === "on",
        supportEmail: String(fd.get("supportEmail") ?? "") || null,
        // Always seed one tier. With paddlePriceId optional so admin can
        // create a product before the Paddle price exists in dashboard.
        tiers: [
          {
            plan: tierPlan || "永久",
            paddlePriceId: tierPriceId || null,
          },
        ],
      };

      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Error ${res.status}`);
        return;
      }

      const body = await res.json();
      toast.success("Product created");
      startTransition(() => {
        router.push(`/dashboard/products/${body.product.id}`);
        router.refresh();
      });
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
          <Input id="name" name="name" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="paddleProductId">Paddle product ID</Label>
          <Input
            id="paddleProductId"
            name="paddleProductId"
            placeholder="pro_xxx (optional)"
          />
          <p className="text-xs text-muted-foreground">
            Webhook matches incoming transactions by this value (or via
            <code className="font-mono"> custom_data.productId </code>
            at checkout).
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="slug">Slug</Label>
        <Input
          id="slug"
          name="slug"
          required
          pattern="[a-z0-9-]+"
          placeholder="something-unique"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input id="description" name="description" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="maxActivations">Max activations</Label>
          <Input
            id="maxActivations"
            name="maxActivations"
            type="number"
            min={1}
            max={100}
            defaultValue={3}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="active">Active</Label>
          <div className="flex h-9 items-center gap-2">
            <input id="active" name="active" type="checkbox" defaultChecked />
            <span className="text-sm text-muted-foreground">Selling</span>
          </div>
        </div>
      </div>
      <div className="space-y-2 border-t pt-4">
        <Label className="text-base">First price tier</Label>
        <p className="text-xs text-muted-foreground">
          One tier is required at creation. Add more (e.g. 30天 / 一年 /
          永久) from the product edit page once support for timed plans is
          enabled. expiresInDays is locked at <code>null</code> (lifetime)
          for now.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tierPlan">Plan name</Label>
            <Input
              id="tierPlan"
              name="tierPlan"
              defaultValue="永久"
              placeholder="永久 / pro / team"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tierPaddlePriceId">Paddle price ID</Label>
            <Input
              id="tierPaddlePriceId"
              name="tierPaddlePriceId"
              placeholder="pri_xxx (optional)"
            />
          </div>
        </div>
      </div>
      <div className="space-y-2 border-t pt-4">
        <Label htmlFor="supportEmail">Support email</Label>
        <Input
          id="supportEmail"
          name="supportEmail"
          type="email"
          placeholder="support@henri.ren"
        />
        <p className="text-xs text-muted-foreground">
          Substituted into{" "}
          <code className="font-mono">{`{{supportEmail}}`}</code> at send time.
          Falls back to <code>SUPPORT_EMAIL</code> from env when empty. The
          default English email template is created automatically; you can edit
          it or add more languages on the next page.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy && <Spinner />}
        {busy ? "Creating…" : "Create product"}
      </Button>
    </form>
  );
}