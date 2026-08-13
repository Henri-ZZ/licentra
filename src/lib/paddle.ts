import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

/**
 * Paddle Billing webhook helpers.
 *
 * Signature verification (HMAC-SHA256 over `"${ts}:${rawBody}"`) and a
 * Paddle-event-type dispatcher. We keep the type set intentionally narrow
 * for v1 — add new branches as Paddle surfaces new event shapes we care
 * about.
 */

export interface PaddleSignatureHeader {
  ts: number;
  h1: string;
}

export function parsePaddleSignature(header: string | null): PaddleSignatureHeader | null {
  if (!header) return null;
  // Format: "ts=1234567890;h1=abcdef..."
  const parts = Object.fromEntries(
    header
      .split(";")
      .map((kv) => kv.split("="))
      .filter((kv) => kv.length === 2)
  );
  const ts = Number(parts.ts);
  const h1 = parts.h1;
  if (!Number.isFinite(ts) || !h1) return null;
  return { ts, h1 };
}

/**
 * Verifies a Paddle webhook signature. Constant-time comparison to defeat
 * timing attacks; rejects if the timestamp is more than 5 minutes skewed.
 */
export function verifyPaddleSignature(
  rawBody: string,
  header: string | null,
  options: { now?: number; tolerance?: number } = {}
): boolean {
  const parsed = parsePaddleSignature(header);
  if (!parsed) return false;

  const tolerance = options.tolerance ?? 5 * 60; // 5 minutes
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.ts) > tolerance) return false;

  const expected = createHmac("sha256", env.PADDLE_WEBHOOK_SECRET)
    .update(`${parsed.ts}:${rawBody}`, "utf8")
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(parsed.h1, "hex");

  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

// ---------------------------------------------------------------------------
// Event payload types — only the fields we actually read.
// Paddle's full schemas live at https://developer.paddle.com/webhooks/...
// ---------------------------------------------------------------------------

export interface PaddleCustomData {
  productId?: string;
  [k: string]: unknown;
}

export interface PaddleTransactionItem {
  // Paddle nests the product reference under `price.product_id` in the
  // transaction.completed payload (e.g. `items[0].price.product_id`).
  // Keep a flat `product_id` too as a defensive fallback for other shapes.
  product_id?: string;
  price_id?: string;
  quantity?: number;
  price?: {
    id: string;
    product_id: string;
    [k: string]: unknown;
  };
}

export interface PaddleTransactionCompleted {
  event_id: string;
  event_type: "transaction.completed";
  occurred_at: string;
  data: {
    id: string;
    status: string;
    customer_id?: string | null;
    custom_data?: PaddleCustomData | null;
    items?: PaddleTransactionItem[];
    // Paddle Billing includes customer data on the transaction itself,
    // including the checkout locale (`en-US`, `zh-CN`, ...). Field
    // placement has varied across Paddle API versions, so callers should
    // fall back through `details.customer.*` if these are missing.
    customer?: {
      id?: string;
      email?: string;
      name?: string | null;
      locale?: string;
    } | null;
    details?: {
      totals?: {
        // Paddle sends money as strings in minor units (e.g. "1920" cents).
        grand_total?: string;
        currency_code?: string;
      };
      customer?: {
        email?: string;
        locale?: string;
      };
    };
  };
}

export interface PaddleTransactionUpdated {
  event_id: string;
  event_type: "transaction.updated";
  occurred_at: string;
  data: {
    id: string;
    status: string;
    customer_id?: string | null;
    custom_data?: PaddleCustomData | null;
  };
}

export type PaddleEvent =
  | PaddleTransactionCompleted
  | PaddleTransactionUpdated
  | { event_id: string; event_type: string; [k: string]: unknown };

export function isCompletedTransaction(
  e: PaddleEvent
): e is PaddleTransactionCompleted {
  return e.event_type === "transaction.completed";
}

export function isUpdatedTransaction(
  e: PaddleEvent
): e is PaddleTransactionUpdated {
  return e.event_type === "transaction.updated";
}

export const REFUNDED_STATUSES = new Set([
  "refunded",
  "partially_refunded",
  "canceled",
  "cancelled",
]);

export function isRefundedStatus(status: string): boolean {
  return REFUNDED_STATUSES.has(status.toLowerCase());
}

// ---------------------------------------------------------------------------
// Paddle API (customer lookup)
// ---------------------------------------------------------------------------

export function getPaddleApiBaseUrl(): string {
  // Paddle sandbox API keys contain "_sdbx"; live keys do not.
  return env.PADDLE_API_KEY.includes("_sdbx")
    ? "https://sandbox-api.paddle.com"
    : "https://api.paddle.com";
}

export interface PaddleCustomer {
  id: string;
  email: string;
  name?: string | null;
  // Customer's preferred locale (BCP 47, e.g. "zh-CN"). Used to pick the
  // email template language.
  locale?: string;
  [k: string]: unknown;
}

export interface CustomerInfo {
  email: string;
  locale: string | null;
}

/**
 * Fetches a customer from the Paddle API by customer_id. Returns null when
 * the customer is missing or has no email — callers treat null as fatal
 * because email is the only delivery channel for license keys.
 */
export async function fetchCustomer(
  customerId: string | null | undefined
): Promise<CustomerInfo | null> {
  if (!customerId) return null;
  const url = `${getPaddleApiBaseUrl()}/customers/${customerId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.PADDLE_API_KEY}` },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `Paddle API GET /customers/${customerId} failed with ${res.status}`
    );
  }
  const json = (await res.json()) as { data?: PaddleCustomer };
  const data = json.data;
  if (!data) return null;
  const email = data.email?.trim();
  if (!email) return null;
  return {
    email,
    locale: data.locale?.trim() || null,
  };
}
