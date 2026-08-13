"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Tier {
  id: string;
  plan: string;
  paddlePriceId: string | null;
  _count: { licenses: number };
}

interface Props {
  productId: string;
  tier: Tier;
  hasLicenses: boolean;
  onBusyChange?: (busy: boolean) => void;
  onDeleted: () => void;
}

/**
 * Delete a PriceTier. Refuses if any license currently references it
 * (API returns 409 tier_has_licenses). The button is also disabled when
 * licenses exist so the user doesn't even try.
 */
export function DeleteTierButton({
  productId,
  tier,
  hasLicenses,
  onBusyChange,
  onDeleted,
}: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [, startTransition] = useTransition();

  async function onConfirm() {
    setError(null);
    setInFlight(true);
    onBusyChange?.(true);
    try {
      const res = await fetch(
        `/api/products/${productId}/tiers/${tier.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Error ${res.status}`);
        return;
      }
      toast.success(`Removed ${tier.plan} tier`);
      setOpen(false);
      startTransition(() => onDeleted());
    } finally {
      setInFlight(false);
      onBusyChange?.(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-destructive hover:text-destructive"
        disabled={hasLicenses || inFlight}
        title={
          hasLicenses
            ? "Tier has licenses — revoke or reassign them first"
            : undefined
        }
      >
        <Trash2 className="size-4" />
        Delete
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &quot;{tier.plan}&quot; tier?</DialogTitle>
          <DialogDescription>
            Removes the tier from this product. If{" "}
            <code className="font-mono">paddlePriceId</code> is set, webhooks
            can no longer match to it.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={inFlight}
          >
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={inFlight}>
            {inFlight && <Spinner />}
            {inFlight ? "Deleting…" : "Delete tier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}