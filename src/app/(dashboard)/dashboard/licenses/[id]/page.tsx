import { notFound } from "next/navigation";

import { LicenseRowActions } from "@/app/(dashboard)/dashboard/licenses/license-row-actions";
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
  params: Promise<{ id: string }>;
}

export default async function LicenseDetailPage({ params }: PageProps) {
  const { id } = await params;
  const license = await prisma.licenseKey.findUnique({
    where: { id },
    include: {
      product: true,
      order: true,
      activations: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!license) notFound();

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">License</h1>
          <p className="font-mono text-xs text-muted-foreground">{license.id}</p>
        </div>
        <LicenseRowActions licenseId={license.id} revoked={license.revoked} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>
            The raw key is never stored. If lost, regenerate below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Product" value={license.product?.name ?? "—"} />
          <Row label="Status" value={
            license.revoked ? (
              <Badge variant="destructive">
                {license.revokedReason ?? "revoked"}
              </Badge>
            ) : (
              <Badge variant="success">active</Badge>
            )
          } />
          <Row label="Max activations" value={license.maxActivations.toString()} />
          <Row label="Customer email" value={license.order?.paddleEmail ?? "—"} />
          <Row label="Paddle transaction" value={
            <span className="font-mono text-xs">{license.order?.paddleTransactionId ?? "—"}</span>
          } />
          <Row label="Created" value={license.createdAt.toISOString()} />
          {license.revokedAt && (
            <Row label="Revoked at" value={license.revokedAt.toISOString()} />
          )}
          <Row label="Emailed at" value={license.emailedAt?.toISOString() ?? "—"} />
          {license.emailError && (
            <Row label="Last email error" value={license.emailError} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activations</CardTitle>
          <CardDescription>
            Each row is a fingerprint bound to this license. When full,
            new activations evict the oldest.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {license.activations.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">
              No activations yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Fingerprint</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last check-in</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {license.activations.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.label ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.fingerprint.slice(0, 16)}…
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.ipAddress ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {a.createdAt.toISOString().slice(0, 19).replace("T", " ")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {a.lastCheckedAt.toISOString().slice(0, 19).replace("T", " ")}
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}