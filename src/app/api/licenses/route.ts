import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSessionEmail } from "@/lib/auth";
import { generateLicenseKey, sha256Hex } from "@/lib/license-key";
import { pickTierForOrder } from "@/lib/paddle-webhook";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  productId: z.string().min(1),
  email: z.string().email().max(320),
});

/**
 * Manually create a License (admin-only, bypasses Paddle).
 *
 * Intended for offline / gift / support cases where no Paddle transaction
 * exists. The raw License Key is generated once and returned in this
 * response so the UI can show it to the admin — it is NEVER persisted
 * (only `keyHash` is stored), so the caller must capture it now.
 *
 * The License carries the customer `email` (mirrored onto the License for
 * later resend-email) but has NO Order: Paddle refund webhooks will not
 * touch it — revoke manually if needed.
 */
export async function POST(request: NextRequest) {
  const session = await getSessionEmail();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const product = await prisma.product.findUnique({
    where: { id: parsed.data.productId },
    include: { priceTiers: true },
  });
  if (!product) {
    return NextResponse.json({ error: "product_not_found" }, { status: 404 });
  }
  if (!product.privateKeyEncrypted) {
    // Without a signing key the license can never return a valid signed
    // response — fail fast like the webhook does.
    return NextResponse.json(
      { error: "product_has_no_signing_key" },
      { status: 400 }
    );
  }

  // Snapshot the product's first tier (same heuristic the Paddle webhook
  // uses) so the manual license gets a plan + expiry just like a paid one.
  const tier = pickTierForOrder(product.priceTiers);
  const expiresAt =
    tier?.expiresInDays == null
      ? null
      : new Date(Date.now() + tier.expiresInDays * 24 * 60 * 60 * 1000);

  const rawKey = generateLicenseKey();
  const license = await prisma.license.create({
    data: {
      keyHash: sha256Hex(rawKey),
      productId: product.id,
      tierId: tier?.id ?? null,
      plan: tier?.plan ?? null,
      expiresAt,
      maxActivations: product.maxActivations,
      email: parsed.data.email.trim().toLowerCase(),
    },
  });

  // rawKey is intentionally returned here (and only here) — show it once,
  // then it is unrecoverable.
  return NextResponse.json({ ok: true, licenseId: license.id, rawKey });
}
