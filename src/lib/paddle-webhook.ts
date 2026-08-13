import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";
import {
  isCompletedTransaction,
  isRefundedStatus,
  isUpdatedTransaction,
  verifyPaddleSignature,
  type PaddleEvent,
} from "@/lib/paddle";
import { generateLicenseKey } from "@/lib/license-key";
import {
  isResendStubMode,
  sendLicenseEmail,
  stubSendLicenseEmail,
} from "@/lib/email";
import { extractPaddleLocale, pickTemplate } from "@/lib/locale";
import { prisma } from "@/lib/prisma";

export const FALLBACK_FROM = "Licentra <onboarding@resend.dev>";

/**
 * Generic Paddle webhook dispatcher. Each event type lives at its own URL
 * (`/api/webhook/paddle-<event-name>`), and each URL passes its expected
 * `event_type` here so we can reject misrouted deliveries with a clean 400
 * before touching the WebhookEvent table.
 *
 * Ordering:
 *   1. Verify HMAC-SHA256 signature on the raw body.
 *   2. Parse JSON.
 *   3. Reject if event_type != expectedEventType (Paddle will keep retrying,
 *      which is what you want when the dashboard is misconfigured to point
 *      the wrong URL at this slot — the failure surfaces in Paddle's UI).
 *   4. Insert into WebhookEvent (unique on event_id; duplicate → `{ ok: true, duplicate: true }`).
 *   5. Run the handler.
 *   6. Mark WebhookEvent.processed = true, or .processed = false + error.
 *   7. Return 200 on success; 500 on handler failure so Paddle retries.
 */
export async function processWebhookEvent<T extends PaddleEvent>(opts: {
  request: NextRequest;
  expectedEventType: string;
  typeGuard: (e: PaddleEvent) => e is T;
  handler: (e: T) => Promise<void>;
}): Promise<NextResponse> {
  const { request, expectedEventType, typeGuard, handler } = opts;

  const rawBody = await request.text();
  const sigHeader = request.headers.get("paddle-signature");

  if (!verifyPaddleSignature(rawBody, sigHeader)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let event: PaddleEvent;
  try {
    event = JSON.parse(rawBody) as PaddleEvent;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (event.event_type !== expectedEventType) {
    return NextResponse.json(
      {
        error: "wrong_event_type",
        expected: expectedEventType,
        got: event.event_type,
      },
      { status: 400 }
    );
  }

  // Idempotent: short-circuit if we've already processed this event.
  const existing = await prisma.webhookEvent.findUnique({
    where: { paddleEventId: event.event_id },
  });
  if (existing) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const row = await prisma.webhookEvent.create({
    data: {
      paddleEventId: event.event_id,
      eventType: event.event_type,
      payload: event as unknown as object,
      processed: false,
    },
  });

  try {
    if (!typeGuard(event)) {
      // Unreachable since we checked event_type above, but keeps TS happy.
      return NextResponse.json({ error: "type_guard_failed" }, { status: 400 });
    }
    await handler(event);
    await prisma.webhookEvent.update({
      where: { id: row.id },
      data: { processed: true, error: null },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.webhookEvent.update({
      where: { id: row.id },
      data: { processed: false, error: message },
    });
    // 500 makes Paddle retry the event — desired for transient failures
    // (e.g. Resend down, DB hiccup).
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleTransactionCompleted(event: PaddleEvent) {
  if (!isCompletedTransaction(event)) return;
  const tx = event.data;

  const productIdSlug =
    tx.custom_data?.productId ?? tx.items?.[0]?.product_id ?? null;

  const product = await findProductByPaddleRef(productIdSlug);
  if (!product) {
    throw new Error(
      `paddle product ${productIdSlug ?? "?"} not linked to any Licentra product`
    );
  }

  // Ensure the product has a key pair before we generate license keys.
  if (!product.privateKeyEncrypted) {
    throw new Error(
      `product ${product.slug} has no signing key; generate one in the dashboard first`
    );
  }

  const transactionId = tx.id;
  const customerEmail = tx.details?.customer?.email ?? "";
  const grandTotal = tx.details?.totals?.grand_total ?? 0;
  const currency = tx.details?.totals?.currency_code ?? "USD";
  const paddleLocale = extractPaddleLocale(event);

  // Idempotency at the Order level: if we've already saved this transaction,
  // reuse the existing Order/LicenseKey and just retry the email.
  const existingOrder = await prisma.order.findUnique({
    where: { paddleTransactionId: transactionId },
    include: {
      licenses: true,
      product: { include: { templates: true } },
    },
  });

  if (existingOrder) {
    // Same transaction re-delivered (different event_id). Make sure the
    // license key was emailed; if not, retry.
    const license = existingOrder.licenses[0];
    if (license && !license.emailedAt && existingOrder.product) {
      const tpl = pickTemplate(
        existingOrder.product.templates,
        existingOrder.locale
      );
      await sendLicenseEmailForLicense({
        licenseId: license.id,
        product: {
          ...existingOrder.product,
          plan: license.plan ?? "",
          fromAddress: tpl?.fromAddress ?? FALLBACK_FROM,
          subject: tpl?.subject ?? "",
          bodyHtml: tpl?.bodyHtml ?? "",
        },
        customerEmail,
      });
    }
    return;
  }

  // First time seeing this transaction — create the Order and a LicenseKey.
  const order = await prisma.order.create({
    data: {
      paddleTransactionId: transactionId,
      paddleCustomerId: tx.customer_id ?? null,
      paddleEmail: customerEmail,
      locale: paddleLocale,
      productId: product.id,
      amount: grandTotal,
      currency,
      status: tx.status,
      rawPayload: event as unknown as object,
    },
  });

  const rawKey = generateLicenseKey();
  const { sha256Hex } = await import("@/lib/license-key");

  // Resolve the price tier for this transaction. The webhook currently
  // matches product by Paddle product_id only (see
  // docs/plans/price-tiers.md). With one tier we use it; with multiple
  // tiers we fall back to the oldest by createdAt and log a warning.
  // priceId-based matching is the next iteration.
  const tier = pickTierForOrder(product.priceTiers);
  if (!tier) {
    throw new Error(
      `product ${product.slug} has no price tiers; add one in the dashboard`,
    );
  }
  const expiresAt =
    tier.expiresInDays == null
      ? null
      : new Date(Date.now() + tier.expiresInDays * 24 * 60 * 60 * 1000);

  const license = await prisma.licenseKey.create({
    data: {
      keyHash: sha256Hex(rawKey),
      productId: product.id,
      tierId: tier.id,
      plan: tier.plan,
      expiresAt,
      orderId: order.id,
      maxActivations: product.maxActivations,
    },
  });

  // Hold the raw key in memory just long enough to send the email.
  const tpl = pickTemplate(product.templates, paddleLocale);

  await sendLicenseEmailForLicense({
    licenseId: license.id,
    product: {
      ...product,
      plan: tier.plan,
      fromAddress: tpl?.fromAddress ?? FALLBACK_FROM,
      subject: tpl?.subject ?? "",
      bodyHtml: tpl?.bodyHtml ?? "",
    },
    customerEmail,
    rawKeyOverride: rawKey,
  });
}

export async function handleTransactionUpdated(event: PaddleEvent) {
  if (!isUpdatedTransaction(event)) return;
  const tx = event.data;

  if (!isRefundedStatus(tx.status)) return;

  const order = await prisma.order.findUnique({
    where: { paddleTransactionId: tx.id },
    include: { licenses: true },
  });
  if (!order) return;

  await prisma.$transaction(async (db) => {
    await db.order.update({
      where: { id: order.id },
      data: { status: tx.status },
    });
    if (order.licenses.length === 0) return;
    await db.licenseKey.updateMany({
      where: { id: { in: order.licenses.map((l) => l.id) } },
      data: {
        revoked: true,
        revokedAt: new Date(),
        revokedReason: "refunded",
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function findProductByPaddleRef(paddleProductId: string | null) {
  if (!paddleProductId) return null;
  // Try by paddleProductId first; the webhook's custom_data.productId is the
  // Licentra Product.id in our setup, but we also support the literal
  // Paddle product_id as a fallback.
  return prisma.product.findFirst({
    where: {
      OR: [
        { paddleProductId },
        { id: paddleProductId },
      ],
    },
    include: { templates: true, priceTiers: true },
  });
}

/**
 * Picks which PriceTier should back a license for a given order.
 *
 * The webhook currently matches product by Paddle product_id only — see
 * docs/plans/price-tiers.md for the rationale. So we don't know which
 * tier the buyer actually chose; this helper is the fallback rule until
 * we add price_id matching:
 *
 *   - 0 tiers  → null (caller treats as fatal error).
 *   - 1 tier   → use it.
 *   - N tiers  → use the oldest by createdAt and log a warning. Eventually
 *                we'll read tx.items[0].price_id and look it up by
 *                paddlePriceId; until then, "first tier added" is the
 *                safest heuristic — admin typically creates the lifetime
 *                tier first and adds 30天/一年 later.
 */
export function pickTierForOrder<
  T extends { id: string; plan: string; expiresInDays: number | null; createdAt: Date },
>(tiers: T[]): T | null {
  if (tiers.length === 0) return null;
  if (tiers.length === 1) return tiers[0];
  const sorted = [...tiers].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  console.warn(
    `[webhook] product has ${tiers.length} tiers; picking oldest (${sorted[0].plan}). ` +
      `priceId-based matching not yet implemented — see docs/plans/price-tiers.md.`,
  );
  return sorted[0];
}

interface SendLicenseEmailParams {
  licenseId: string;
  product:
    | (ProductForEmail & {
        fromAddress: string;
        subject: string;
        bodyHtml: string;
      })
    | null;
  customerEmail: string;
  rawKeyOverride?: string;
}

interface ProductForEmail {
  name: string;
  slug: string;
  // `plan` now lives on the matched PriceTier, not the Product. We pass it
  // through here so the `{{plan}}` email placeholder still interpolates.
  plan: string;
  maxActivations: number;
  supportEmail: string | null;
}

/**
 * Sends the license email to the customer. Updates emailedAt / emailError
 * on the LicenseKey row. If rawKey is not provided, we look up the existing
 * license key from the database (we only have the hash, so this path is
 * intentionally best-effort — see plan).
 */
async function sendLicenseEmailForLicense(p: SendLicenseEmailParams) {
  // NB: rawKeyOverride is used for first-time sends. On retries we don't
  // have the raw key (it was never persisted). For a true retry we'd need
  // to either (a) re-generate and revoke the previous key, or (b) store
  // the raw key encrypted. v1 keeps it simple: refuse to retry if we
  // can't recover the key.
  if (!p.rawKeyOverride) {
    console.warn(
      `[webhook] no raw key to resend for license ${p.licenseId}; admin must manually reset`
    );
    await prisma.licenseKey.update({
      where: { id: p.licenseId },
      data: {
        emailError: "raw key not retained across retries",
        emailAttempts: { increment: 1 },
      },
    });
    return;
  }

  if (!p.customerEmail) {
    await prisma.licenseKey.update({
      where: { id: p.licenseId },
      data: {
        emailError: "no customer email on transaction",
        emailAttempts: { increment: 1 },
      },
    });
    return;
  }

  if (!p.product) {
    await prisma.licenseKey.update({
      where: { id: p.licenseId },
      data: {
        emailError: "product missing",
        emailAttempts: { increment: 1 },
      },
    });
    return;
  }

  const { subject, bodyHtml, fromAddress } = p.product;

  try {
    const send = isResendStubMode() ? stubSendLicenseEmail : sendLicenseEmail;
    await send({
      to: p.customerEmail,
      fromAddress,
      subject,
      bodyHtml,
      vars: {
        code: p.rawKeyOverride,
        productName: p.product.name,
        plan: p.product.plan,
        orderId: p.licenseId,
        email: p.customerEmail,
        maxActivations: p.product.maxActivations,
        supportEmail: p.product.supportEmail ?? env.SUPPORT_EMAIL,
      },
    });
    await prisma.licenseKey.update({
      where: { id: p.licenseId },
      data: {
        emailedAt: new Date(),
        emailError: null,
        emailAttempts: { increment: 1 },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.licenseKey.update({
      where: { id: p.licenseId },
      data: {
        emailError: message,
        emailAttempts: { increment: 1 },
      },
    });
    throw err;
  }
}
