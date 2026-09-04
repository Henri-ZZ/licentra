import Link from "next/link";

import { CreateLicenseDialog } from "@/app/(dashboard)/dashboard/licenses/create-license-dialog";
import { LicensesRefreshButton } from "@/app/(dashboard)/dashboard/licenses/licenses-refresh-button";
import { LicensesSearchForm } from "@/app/(dashboard)/dashboard/licenses/licenses-search-form";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTimeCn } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

interface PageProps {
  searchParams: Promise<{ q?: string; productId?: string }>;
}

export default async function LicensesPage({ searchParams }: PageProps) {
  const { q, productId } = await searchParams;

  const products = await prisma.product.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const licenses = await prisma.license.findMany({
    where: {
      AND: [
        productId ? { productId } : {},
        // keyHash search is meaningless for the admin (raw key never stored);
        // searching order email, license email, or transaction ID instead.
        q
          ? {
              OR: [
                {
                  order: { paddleEmail: { contains: q, mode: "insensitive" } },
                },
                { email: { contains: q, mode: "insensitive" } },
                { order: { paddleTransactionId: { contains: q } } },
                { id: { contains: q } },
              ],
            }
          : {},
      ],
    },
    include: {
      product: true,
      order: true,
      activations: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Licenses</h1>
          <p className="text-sm text-muted-foreground">
            Raw license keys are never stored — only SHA-256 hashes. Use the
            order email or transaction ID to find a customer.
          </p>
        </div>
        <CreateLicenseDialog
          products={products}
          defaultProductId={productId ?? null}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Search</CardTitle>
            <CardDescription>
              Filter by product, customer email, paddle transaction ID, or
              license ID.
            </CardDescription>
          </div>
          <LicensesRefreshButton />
        </CardHeader>
        <CardContent>
          <LicensesSearchForm
            products={products}
            defaultProductId={productId}
            defaultValue={q}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{licenses.length} license(s)</CardTitle>
        </CardHeader>
        <CardContent>
          {licenses.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">
              No licenses match.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>License ID</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Activations</TableHead>
                  <TableHead>Last activated</TableHead>
                  <TableHead>Last check-in</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {licenses.map((l) => {
                  // activations are ordered by createdAt asc → the last one
                  // is the most recently registered device.
                  const lastActivation = l.activations.length
                    ? l.activations[l.activations.length - 1]
                    : null;
                  const lastActivatedAt = lastActivation?.createdAt ?? null;
                  const lastCheckedInAt = l.activations.reduce<Date | null>(
                    (max, a) =>
                      max === null || a.lastCheckedAt > max
                        ? a.lastCheckedAt
                        : max,
                    null,
                  );
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs">
                        <Link
                          href={`/dashboard/licenses/${l.id}`}
                          className="hover:underline"
                        >
                          {l.id}
                        </Link>
                      </TableCell>
                      <TableCell>{l.product?.name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {l.order?.paddleEmail ?? l.email ?? "—"}
                      </TableCell>
                      <TableCell>
                        {l.activations.length} / {l.maxActivations}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap min-w-[230px]">
                        <div className="flex items-center gap-1.5">
                          <span>{formatDateTimeCn(lastActivatedAt)}</span>
                          {lastActivation?.browser && (
                            <span className="rounded border px-1 text-[10px] leading-4 text-muted-foreground">
                              {lastActivation.browser}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatDateTimeCn(lastCheckedInAt)}
                      </TableCell>
                      <TableCell>
                        {l.revoked ? (
                          <div className="flex items-center gap-1.5">
                            <Badge variant="destructive">revoked</Badge>
                            {l.revokedReason &&
                              l.revokedReason !== "revoked" && (
                                <span className="text-xs text-muted-foreground">
                                  {l.revokedReason}
                                </span>
                              )}
                          </div>
                        ) : (
                          <Badge variant="success">active</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
