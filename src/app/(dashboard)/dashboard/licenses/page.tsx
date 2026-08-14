import Link from "next/link";

import { LicenseRowActions } from "@/app/(dashboard)/dashboard/licenses/license-row-actions";
import { LicensesSearchForm } from "@/app/(dashboard)/dashboard/licenses/licenses-search-form";
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
import { prisma } from "@/lib/prisma";

interface PageProps {
  searchParams: Promise<{ q?: string; productId?: string }>;
}

export default async function LicensesPage({ searchParams }: PageProps) {
  const { q, productId } = await searchParams;

  const licenses = await prisma.license.findMany({
    where: {
      AND: [
        productId ? { productId } : {},
        // keyHash search is meaningless for the admin (raw key never stored);
        // searching order email, license email, or transaction ID instead.
        q
          ? {
              OR: [
                { order: { paddleEmail: { contains: q, mode: "insensitive" } } },
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Licenses</h1>
        <p className="text-sm text-muted-foreground">
          Raw license keys are never stored — only SHA-256 hashes. Use the
          order email or transaction ID to find a customer.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>
          <CardDescription>
            Filter by customer email, paddle transaction ID, or license ID.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LicensesSearchForm defaultValue={q} />
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
                  <TableHead>Emailed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {licenses.map((l) => (
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
                    <TableCell>
                      {l.emailedAt ? (
                        <Badge variant="success">sent</Badge>
                      ) : (
                        <Badge variant="destructive">pending</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {l.revoked ? (
                        <Badge variant="destructive">
                          {l.revokedReason ?? "revoked"}
                        </Badge>
                      ) : (
                        <Badge variant="success">active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <LicenseRowActions licenseId={l.id} revoked={l.revoked} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
