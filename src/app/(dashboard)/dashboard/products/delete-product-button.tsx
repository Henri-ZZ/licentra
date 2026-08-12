"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  productId: string;
  productName: string;
  productSlug: string;
  licenseCount: number;
}

/**
 * Deletes a Product row. Refuses (server-side) if the product has any
 * licenses — those are Paddle-issued and must never be silently lost.
 *
 * UX: requires the user to type the slug verbatim. The slug is what
 * client apps embed to look up the public key, so it's also the most
 * stable identifier the admin has at hand.
 */
export function DeleteProductButton({
  productId,
  productName,
  productSlug,
  licenseCount,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [inFlight, setInFlight] = useState(false);

  const hasLicenses = licenseCount > 0;
  const slugMatches = confirmSlug.trim() === productSlug;

  async function onConfirm() {
    setError(null);
    setInFlight(true);
    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Error ${res.status}`);
        return;
      }
      toast.success(`Deleted ${productName}`);
      setOpen(false);
      startTransition(() => {
        router.push("/dashboard/products");
        router.refresh();
      });
    } finally {
      setInFlight(false);
    }
  }

  const busy = inFlight || pending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setConfirmSlug("");
          setError(null);
        }
      }}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-destructive hover:text-destructive"
        disabled={hasLicenses}
        title={hasLicenses ? "Cannot delete a product with licenses" : undefined}
      >
        <Trash2 className="size-4" />
        Delete
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &quot;{productName}&quot;?</DialogTitle>
          <DialogDescription>
            {hasLicenses ? (
              <span className="text-destructive">
                This product has {licenseCount} license
                {licenseCount === 1 ? "" : "s"} and cannot be deleted. Revoke
                or transfer licenses first.
              </span>
            ) : (
              <>
                This permanently removes the product, its signing key, and
                email template. Type the slug{" "}
                <code className="font-mono">{productSlug}</code> to confirm.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {!hasLicenses && (
          <div className="space-y-2">
            <Label htmlFor="confirm-slug">Slug</Label>
            <Input
              id="confirm-slug"
              value={confirmSlug}
              onChange={(e) => setConfirmSlug(e.target.value)}
              placeholder={productSlug}
              autoComplete="off"
              autoFocus
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          {!hasLicenses && (
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={busy || !slugMatches}
            >
              {busy && <Spinner />}
              {busy ? "Deleting…" : "Delete product"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}