import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";
import {
  fetchCustomer,
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
 *   4. Idempotency guard: return `{ ok: true, duplicate: true }` only if a
 *      prior delivery already set processed=true. If a previous attempt
 *      failed (processed=false), re-run the handler so the retry completes.
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

  // Idempotency: skip only if a previous delivery already SUCCEEDED. If a
  // prior attempt failed (processed=false), re-run the handler so Paddle's
  // retry can actually finish the work. The handler is itself idempotent at
  // the Order level (paddleTransactionId unique), so re-running is safe.
  let row = await prisma.webhookEvent.findUnique({
    where: { paddleEventId: event.event_id },
  });
  if (row?.processed) {
    return NextResponse.json({ ok: true, duplicate: true });
  }
  if (!row) {
    row = await prisma.webhookEvent.create({
      data: {
        paddleEventId: event.event_id,
        eventType: event.event_type,
        payload: event as unknown as object,
        processed: false,
      },
    });
  }

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
    tx.custom_data?.productId ??
    tx.items?.[0]?.price?.product_id ??
    tx.items?.[0]?.product_id ??
    null;

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
  const customerId = tx.customer_id ?? null;
  // The webhook payload doesn't carry the customer's email or locale. Fetch
  // both from the Paddle API by customer_id — email is the only delivery
  // channel for the license, so fail fast (before creating any Order/
  // LicenseKey) when we can't resolve it.
  const customer = await fetchCustomer(customerId);
  if (!customer) {
    throw new Error(
      `customer ${customerId ?? "?"} has no email in Paddle; cannot deliver license`
    );
  }
  const customerEmail = customer.email;
  // Prefer the customer's own locale (from the API) over the webhook payload,
  // which usually doesn't include one.
  const paddleLocale = customer.locale ?? extractPaddleLocale(event);
  // Paddle sends money as strings in minor units (e.g. "1920" = 19.20).
  // Order.amount is Int, so parse before writing.
  const grandTotal = parseInt(tx.details?.totals?.grand_total ?? "0", 10) || 0;
  const currency = tx.details?.totals?.currency_code ?? "USD";

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
        transactionId,
        product: {
          ...existingOrder.product,
          plan: license.plan ?? "",
          fromAddress: tpl?.fromAddress ?? null,
          fromName: tpl?.fromName ?? null,
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
      paddleCustomerId: customerId,
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
    transactionId,
    product: {
      ...product,
      plan: tier.plan,
      fromAddress: tpl?.fromAddress ?? null,
      fromName: tpl?.fromName ?? null,
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
  transactionId: string;
  product:
    | (ProductForEmail & {
        fromAddress: string | null;
        fromName: string | null;
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

  const { subject, bodyHtml, fromAddress, fromName } = p.product;
  // Combine the template's display name + address into Resend's
  // "Name <email>" form. Fall back to FALLBACK_FROM when no address is set.
  const from = fromName && fromAddress
    ? `${fromName} <${fromAddress}>`
    : (fromAddress ?? FALLBACK_FROM);

  try {
    const send = isResendStubMode() ? stubSendLicenseEmail : sendLicenseEmail;
    await send({
      to: p.customerEmail,
      fromAddress: from,
      subject,
      bodyHtml,
      vars: {
        code: p.rawKeyOverride,
        productName: p.product.name,
        plan: p.product.plan,
        orderId: p.transactionId,
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
