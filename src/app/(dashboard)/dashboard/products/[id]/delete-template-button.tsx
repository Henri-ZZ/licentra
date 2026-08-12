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

interface Template {
  id: string;
  locale: string;
  displayName: string;
}

interface Props {
  productId: string;
  template: Template;
  isProtected: boolean;
  onBusyChange?: (busy: boolean) => void;
  onDeleted: () => void;
}

export function DeleteTemplateButton({
  productId,
  template,
  isProtected,
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
        `/api/products/${productId}/templates/${template.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Error ${res.status}`);
        return;
      }
      toast.success(`Removed ${template.displayName} template`);
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
        disabled={isProtected || inFlight}
        title={
          isProtected
            ? "English is the default and cannot be deleted"
            : undefined
        }
      >
        <Trash2 className="size-4" />
        Delete
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &quot;{template.displayName}&quot; template?</DialogTitle>
          <DialogDescription>
            Customers whose Paddle locale matched{" "}
            <code className="font-mono">{template.locale}</code> will fall
            back to the default (English) template on the next purchase.
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
            {inFlight ? "Deleting…" : "Delete template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
