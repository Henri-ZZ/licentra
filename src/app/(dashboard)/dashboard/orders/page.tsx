import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/prisma";

export default async function OrdersPage() {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      product: true,
      licenses: true,
    },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
        <p className="text-sm text-muted-foreground">
          All transactions recorded from Paddle webhooks.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{orders.length} order(s)</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">
              No orders yet. Configure the Paddle webhook to start ingesting
              payments.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Transaction</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Licenses</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {o.createdAt.toISOString().slice(0, 19).replace("T", " ")}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {o.paddleTransactionId}
                    </TableCell>
                    <TableCell>{o.product?.name ?? "—"}</TableCell>
                    <TableCell>{o.paddleEmail ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">
                      {(o.amount / 100).toFixed(2)} {o.currency}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          o.status === "completed"
                            ? "success"
                            : o.status === "refunded" ||
                                o.status === "canceled"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {o.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{o.licenses.length}</TableCell>
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