"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { TierFormDialog } from "@/app/(dashboard)/dashboard/products/[id]/tier-form-dialog";
import { DeleteTierButton } from "@/app/(dashboard)/dashboard/products/[id]/delete-tier-button";

export interface Tier {
  id: string;
  plan: string;
  paddlePriceId: string | null;
  expiresInDays: number | null;
  _count: { licenses: number };
}

interface Props {
  productId: string;
  tiers: Tier[];
}

/**
 * Per-plan PriceTiers for a Product.
 *
 * The webhook matches product by Paddle product_id only — see
 * docs/plans/price-tiers.md. priceId on each tier is informational
 * today; once we turn on timed plans it becomes the discriminator for
 * which tier the buyer actually chose. expiresInDays is always null
 * (lifetime) for now.
 */
export function ProductTiersCard({ productId, tiers }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>Price tiers</CardTitle>
          <CardDescription>
            One tier per plan you sell (e.g. 永久, 一年, 30天).{" "}
            <code className="font-mono">expiresInDays</code> is locked at
            {" "}<code>null</code> (lifetime) until timed plans are enabled —
            see <code className="font-mono">docs/plans/price-tiers.md</code>.
            Paddle price ID is informational today; the webhook matches
            product by <code className="font-mono">product_id</code> only.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Add tier
        </Button>
      </CardHeader>
      <CardContent>
        {tiers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No tiers configured. Webhook transactions for this product will
            fail with{" "}
            <code className="font-mono">product has no price tiers</code>{" "}
            until you add one.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead className="w-[160px]">Paddle price</TableHead>
                <TableHead className="w-[120px]">Expires</TableHead>
                <TableHead className="w-[80px]">Licenses</TableHead>
                <TableHead className="w-[160px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tiers.map((t) => (
                <TierRow
                  key={t.id}
                  tier={t}
                  productId={productId}
                  busyId={busyId}
                  setBusyId={setBusyId}
                  onMutated={() => startTransition(() => router.refresh())}
                />
              ))}
            </TableBody>
          </Table>
        )}

        {pending && (
          <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
            <Spinner className="size-3" />
            Refreshing…
          </p>
        )}
      </CardContent>

      <TierFormDialog
        productId={productId}
        mode="create"
        open={open}
        onOpenChange={setOpen}
      />
    </Card>
  );
}

interface RowProps {
  tier: Tier;
  productId: string;
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  onMutated: () => void;
}

function TierRow({ tier, productId, busyId, setBusyId, onMutated }: RowProps) {
  const [editOpen, setEditOpen] = useState(false);
  const isBusy = busyId === tier.id;
  const hasLicenses = tier._count.licenses > 0;

  return (
    <TableRow>
      <TableCell className="font-medium">
        {tier.plan}
        {hasLicenses ? (
          <Badge variant="secondary" className="ml-2">
            in use
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="font-mono text-xs">
        {tier.paddlePriceId ?? (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {tier.expiresInDays == null ? "lifetime" : `${tier.expiresInDays} days`}
      </TableCell>
      <TableCell className="text-sm">{tier._count.licenses}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
            disabled={isBusy}
          >
            Edit
          </Button>
          <DeleteTierButton
            productId={productId}
            tier={tier}
            hasLicenses={hasLicenses}
            onBusyChange={(b) => setBusyId(b ? tier.id : null)}
            onDeleted={onMutated}
          />
        </div>
      </TableCell>

      <TierFormDialog
        productId={productId}
        mode="edit"
        tier={tier}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </TableRow>
  );
}