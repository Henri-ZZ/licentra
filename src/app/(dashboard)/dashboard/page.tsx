import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";

export default async function DashboardOverviewPage() {
  // Aggregates for the top of the dashboard.
  const [productCount, licenseCount, activeLicenseCount, recentOrders] =
    await Promise.all([
      prisma.product.count(),
      prisma.licenseKey.count(),
      prisma.licenseKey.count({ where: { revoked: false } }),
      prisma.order.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { product: true },
      }),
    ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Top-level view of products, licenses, and recent orders.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Products</CardDescription>
            <CardTitle className="text-3xl">{productCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/products">Manage products</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Licenses</CardDescription>
            <CardTitle className="text-3xl">{licenseCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {activeLicenseCount} active
            </p>
            <Button variant="outline" size="sm" asChild className="mt-3">
              <Link href="/dashboard/licenses">View licenses</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Recent orders</CardDescription>
            <CardTitle className="text-3xl">{recentOrders.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/orders">All orders</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Latest orders</CardTitle>
        </CardHeader>
        <CardContent>
          {recentOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <ul className="divide-y">
              {recentOrders.map((order) => (
                <li
                  key={order.id}
                  className="flex items-center justify-between py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {order.product?.name ?? "(unknown product)"}
                    </p>
                    <p className="text-muted-foreground font-mono text-xs">
                      {order.paddleTransactionId}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={
                        order.status === "completed" ? "success" : "secondary"
                      }
                    >
                      {order.status}
                    </Badge>
                    <span className="text-muted-foreground tabular-nums">
                      {(order.amount / 100).toFixed(2)} {order.currency}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
