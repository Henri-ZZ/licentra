"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TierSeed {
  id: string;
  plan: string;
  paddlePriceId: string | null;
  expiresInDays: number | null;
}

interface CommonProps {
  productId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

type Props =
  | (CommonProps & { mode: "create" })
  | (CommonProps & { mode: "edit"; tier: TierSeed });

/**
 * Add or edit a PriceTier.
 *
 * expiresInDays is intentionally absent — it's immutable post-creation
 * and locked at null (lifetime) until timed plans are enabled. See
 * docs/plans/price-tiers.md.
 */
export function TierFormDialog(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = props.mode === "edit";
  const editing = isEdit ? props.tier : null;

  const initial = editing ?? { plan: "", paddlePriceId: null as string | null };
  const [plan, setPlan] = useState(initial.plan);
  const [paddlePriceId, setPaddlePriceId] = useState<string>(initial.paddlePriceId ?? "");

  const busy = inFlight || pending;

  function resetFromProps() {
    setPlan(initial.plan);
    setPaddlePriceId(initial.paddlePriceId ?? "");
    setError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const planClean = plan.trim();
    if (!planClean) {
      setError("Plan name is required");
      return;
    }

    setInFlight(true);
    try {
      const url = isEdit
        ? `/api/products/${props.productId}/tiers/${editing!.id}`
        : `/api/products/${props.productId}/tiers`;
      const method = isEdit ? "PATCH" : "POST";
      const payload = {
        plan: planClean,
        paddlePriceId: paddlePriceId.trim() || null,
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Error ${res.status}`);
        return;
      }

      toast.success(isEdit ? "Tier updated" : "Tier added");
      props.onOpenChange(false);
      startTransition(() => router.refresh());
    } finally {
      setInFlight(false);
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (next) resetFromProps();
        props.onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit ${editing!.plan} tier` : "Add price tier"}
          </DialogTitle>
          <DialogDescription>
            One tier per plan you sell. The webhook currently matches
            product by Paddle <code className="font-mono">product_id</code>{" "}
            only, so the price ID is informational until timed plans are
            enabled.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tier-plan">Plan name</Label>
            <Input
              id="tier-plan"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              placeholder="永久 / pro / team / 一年 / 30天"
              required
              maxLength={40}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tier-price">Paddle price ID</Label>
            <Input
              id="tier-price"
              value={paddlePriceId}
              onChange={(e) => setPaddlePriceId(e.target.value)}
              placeholder="pri_xxx (optional)"
              maxLength={120}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Paddle catalog price ID. Optional for now; required later
              when timed plans unlock and the webhook starts matching on
              price.
            </p>
          </div>

          <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
            <code className="font-mono">expiresInDays</code> is locked at
            {" "}<code className="font-mono">null</code> (lifetime) until
            timed plans are enabled. See{" "}
            <code className="font-mono">docs/plans/price-tiers.md</code>.
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Spinner />}
              {busy
                ? isEdit
                  ? "Saving…"
                  : "Adding…"
                : isEdit
                  ? "Save changes"
                  : "Add tier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}