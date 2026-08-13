import { notFound } from "next/navigation";

import { DeleteProductButton } from "@/app/(dashboard)/dashboard/products/delete-product-button";
import { GenerateKeyButton } from "@/app/(dashboard)/dashboard/products/[id]/generate-key-button";
import { ProductEditForm } from "@/app/(dashboard)/dashboard/products/[id]/product-edit-form";
import { ProductTemplatesCard } from "@/app/(dashboard)/dashboard/products/[id]/product-templates-card";
import { ProductTiersCard } from "@/app/(dashboard)/dashboard/products/[id]/product-tiers-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProductDetailPage({ params }: PageProps) {
  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      _count: { select: { licenses: true } },
      templates: { orderBy: [{ isDefault: "desc" }, { locale: "asc" }] },
      priceTiers: {
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { licenses: true } } },
      },
    },
  });
  if (!product) notFound();

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">{product.slug}</span> · {product._count.licenses}{" "}
          license{product._count.licenses === 1 ? "" : "s"}
        </p>
      </div>

      <ProductEditForm product={product} />

      <ProductTiersCard
        productId={product.id}
        tiers={product.priceTiers.map((t) => ({
          id: t.id,
          plan: t.plan,
          paddlePriceId: t.paddlePriceId,
          expiresInDays: t.expiresInDays,
          _count: { licenses: t._count.licenses },
        }))}
      />

      <ProductTemplatesCard
        productId={product.id}
        templates={product.templates.map((t) => ({
          id: t.id,
          locale: t.locale,
          displayName: t.displayName,
          isDefault: t.isDefault,
          fromAddress: t.fromAddress,
          fromName: t.fromName,
          subject: t.subject,
          bodyHtml: t.bodyHtml,
        }))}
      />

      <Card>
        <CardHeader>
          <CardTitle>Signing key</CardTitle>
          <CardDescription>
            Each product gets its own ECDSA P-256 key pair. The private key
            is stored encrypted in the database (AES-256-GCM with your
            LICENSE_MASTER_KEY). The public key is embedded in your
            client&apos;s code, identified by{" "}
            <code className="font-mono">payload.product = &quot;{product.slug}&quot;</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {product.publicKey ? (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Public key (PEM, share with the product owner)</p>
                <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-3 text-xs">
{product.publicKey}
                </pre>
              </div>
              <div className="text-xs text-muted-foreground">
                Fingerprint: <span className="font-mono">{product.publicKeyFingerprint}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Regenerating will invalidate all signed payloads issued under
                the previous key.
              </p>
              <GenerateKeyButton
                productId={product.id}
                hasExistingKey={true}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                No key pair yet. License API calls will fail until you create one.
              </p>
              <GenerateKeyButton
                productId={product.id}
                hasExistingKey={false}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Deleting a product permanently removes its signing key, email
            template, and any metadata. Refunds and historical orders are not
            affected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteProductButton
            productId={product.id}
            productName={product.name}
            productSlug={product.slug}
            licenseCount={product._count.licenses}
          />
        </CardContent>
      </Card>
    </div>
  );
}
