"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ProductOption {
  id: string;
  name: string;
}

interface Props {
  products: ProductOption[];
  defaultProductId?: string | null;
}

/**
 * Manually create a License: pick a product + enter the customer email.
 * On success the raw License Key is shown ONCE in a dialog — we never
 * store plaintext keys, so the admin must copy it before closing.
 */
export function CreateLicenseDialog({ products, defaultProductId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [productId, setProductId] = useState(
    defaultProductId ?? products[0]?.id ?? ""
  );
  const [email, setEmail] = useState("");

  // Result view: rawKey is only available immediately after creation.
  const [result, setResult] = useState<{
    licenseId: string;
    rawKey: string;
    email: string;
    productName: string;
  } | null>(null);

  const busy = inFlight || pending;

  function resetForm() {
    setProductId(defaultProductId ?? products[0]?.id ?? "");
    setEmail("");
    setError(null);
    setResult(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!productId) {
      setError("Select a product");
      return;
    }

    setInFlight(true);
    try {
      const res = await fetch("/api/licenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, email: email.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Error ${res.status}`);
        return;
      }
      const productName = products.find((p) => p.id === productId)?.name ?? "";
      setResult({
        licenseId: body.licenseId,
        rawKey: body.rawKey,
        email: email.trim(),
        productName,
      });
    } finally {
      setInFlight(false);
    }
  }

  async function copyKey() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.rawKey);
      toast.success("License key copied");
    } catch {
      toast.error("Copy failed — select the key manually");
    }
  }

  function close() {
    setOpen(false);
    startTransition(() => router.refresh());
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        New license
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) resetForm();
          setOpen(next);
        }}
      >
        <DialogContent className="max-w-lg">
          {result ? (
            // --- Result view: show the License Key once ---
            <>
              <DialogHeader>
                <DialogTitle>License created</DialogTitle>
                <DialogDescription>
                  The License Key below is shown{" "}
                  <span className="font-semibold">only once</span> — copy it
                  now. Licentra never stores the plaintext key.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>License Key</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={result.rawKey}
                      className="font-mono text-base tracking-wider"
                      onFocus={(e) => e.target.select()}
                    />
                    <Button type="button" variant="outline" onClick={copyKey}>
                      Copy
                    </Button>
                  </div>
                </div>

                <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground space-y-1">
                  <p>
                    Product:{" "}
                    <span className="font-medium">{result.productName}</span>
                  </p>
                  <p>Email: {result.email}</p>
                  <p className="font-mono">License ID: {result.licenseId}</p>
                  <p className="pt-1">
                    No email was sent. Use this code to hand the key to the
                    customer, or use{" "}
                    <span className="font-medium">Resend email</span> later
                    (rotates to a new key).
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button onClick={close}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            // --- Form view ---
            <>
              <DialogHeader>
                <DialogTitle>Create license</DialogTitle>
                <DialogDescription>
                  Manually issue a license (no Paddle order). The activation
                  code is shown once after creation.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="lic-product">Product</Label>
                  <Select
                    value={productId}
                    onValueChange={(v) => setProductId(v)}
                  >
                    <SelectTrigger id="lic-product" className="w-full">
                      <SelectValue placeholder="Select product" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lic-email">Customer email</Label>
                  <Input
                    id="lic-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="customer@example.com"
                    required
                    maxLength={320}
                  />
                  <p className="text-xs text-muted-foreground">
                    Stored on the license for later use; the code is not
                    emailed automatically.
                  </p>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setOpen(false)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={busy}>
                    {busy && <Spinner />}
                    {busy ? "Creating…" : "Create license"}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
