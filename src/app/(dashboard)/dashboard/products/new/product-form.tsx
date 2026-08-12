"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProductForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get("name") ?? ""),
      slug: String(fd.get("slug") ?? ""),
      description: String(fd.get("description") ?? "") || null,
      plan: String(fd.get("plan") ?? "standard"),
      paddleProductId: String(fd.get("paddleProductId") ?? "") || null,
      paddlePriceId: String(fd.get("paddlePriceId") ?? "") || null,
      maxActivations: Number(fd.get("maxActivations") ?? 3),
      active: fd.get("active") === "on",
      emailSubject: String(fd.get("emailSubject") ?? "") || null,
      emailBodyHtml: String(fd.get("emailBodyHtml") ?? "") || null,
      resendFromAddress: String(fd.get("resendFromAddress") ?? "") || null,
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
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="slug">Slug</Label>
          <Input
            id="slug"
            name="slug"
            required
            pattern="[a-z0-9-]+"
            placeholder="stealth-browser-assistant"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input id="description" name="description" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="plan">Plan</Label>
          <Input id="plan" name="plan" defaultValue="standard" />
        </div>
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
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="paddleProductId">Paddle product ID</Label>
          <Input
            id="paddleProductId"
            name="paddleProductId"
            placeholder="pro_xxx (optional)"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="paddlePriceId">Paddle price ID</Label>
          <Input
            id="paddlePriceId"
            name="paddlePriceId"
            placeholder="pri_xxx (optional)"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="resendFromAddress">Email from address</Label>
        <Input
          id="resendFromAddress"
          name="resendFromAddress"
          placeholder="Licentra <noreply@henri.ren>"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="emailSubject">Email subject</Label>
        <Input
          id="emailSubject"
          name="emailSubject"
          placeholder="Your {{productName}} License Key"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="emailBodyHtml">Email body HTML</Label>
        <textarea
          id="emailBodyHtml"
          name="emailBodyHtml"
          rows={10}
          className="flex min-h-[160px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
          defaultValue='<p>Thanks for purchasing {{productName}}!</p><p>Your key: <code>{{key}}</code></p>'
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create product"}
      </Button>
    </form>
  );
}
