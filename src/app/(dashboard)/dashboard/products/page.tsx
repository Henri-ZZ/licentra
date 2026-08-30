import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export default async function ProductsPage() {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { licenses: true } },
      priceTiers: { orderBy: { createdAt: "asc" } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground">
            Each product has its own signing key pair and email template.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/products/new">New product</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All products</CardTitle>
          <CardDescription>
            {products.length} configured. Link Paddle products by ID.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">
              No products yet. Create one to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Plans</TableHead>
                  <TableHead>Max activations</TableHead>
                  <TableHead>Paddle product</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Licenses</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="font-mono text-xs">{p.slug}</TableCell>
                    <TableCell>
                      {p.priceTiers.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {p.priceTiers.map((t) => (
                            <Badge key={t.id} variant="secondary">
                              {t.plan}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.maxActivations}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.paddleProductId ?? "—"}
                    </TableCell>
                    <TableCell>
                      {p.publicKey ? (
                        <Badge variant="success">set</Badge>
                      ) : (
                        <Badge variant="destructive">missing</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {p.active ? (
                        <Badge variant="success">active</Badge>
                      ) : (
                        <Badge variant="secondary">inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>{p._count.licenses}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" asChild>
                        <a href={`/dashboard/products/${p.id}`}>Edit</a>
                      </Button>
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
