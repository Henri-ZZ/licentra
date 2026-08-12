"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Product } from "@prisma/client";

export function ProductEditForm({ product }: { product: Product }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get("name") ?? ""),
      description: String(fd.get("description") ?? "") || null,
      plan: String(fd.get("plan") ?? ""),
      paddleProductId: String(fd.get("paddleProductId") ?? "") || null,
      paddlePriceId: String(fd.get("paddlePriceId") ?? "") || null,
      maxActivations: Number(fd.get("maxActivations") ?? 3),
      active: fd.get("active") === "on",
      emailSubject: String(fd.get("emailSubject") ?? "") || null,
      emailBodyHtml: String(fd.get("emailBodyHtml") ?? "") || null,
      resendFromAddress: String(fd.get("resendFromAddress") ?? "") || null,
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
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" defaultValue={product.name} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="plan">Plan</Label>
          <Input id="plan" name="plan" defaultValue={product.plan} />
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
      <div className="grid gap-4 sm:grid-cols-3">
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
          <Label htmlFor="paddleProductId">Paddle product ID</Label>
          <Input
            id="paddleProductId"
            name="paddleProductId"
            defaultValue={product.paddleProductId ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="paddlePriceId">Paddle price ID</Label>
          <Input
            id="paddlePriceId"
            name="paddlePriceId"
            defaultValue={product.paddlePriceId ?? ""}
          />
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
        <Label htmlFor="resendFromAddress">Email from</Label>
        <Input
          id="resendFromAddress"
          name="resendFromAddress"
          defaultValue={product.resendFromAddress ?? ""}
          placeholder="Licentra <noreply@henri.ren>"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="emailSubject">Email subject</Label>
        <Input
          id="emailSubject"
          name="emailSubject"
          defaultValue={product.emailSubject ?? ""}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="emailBodyHtml">Email body HTML</Label>
        <textarea
          id="emailBodyHtml"
          name="emailBodyHtml"
          rows={10}
          defaultValue={product.emailBodyHtml ?? ""}
          className="flex min-h-[160px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Placeholders: <code className="font-mono">{`{{key}}`}</code>{" "}
        <code className="font-mono">{`{{productName}}`}</code>{" "}
        <code className="font-mono">{`{{plan}}`}</code>{" "}
        <code className="font-mono">{`{{licenseId}}`}</code>{" "}
        <code className="font-mono">{`{{maxActivations}}`}</code>
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
