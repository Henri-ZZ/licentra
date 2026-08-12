import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

/**
 * Paddle Billing webhook helpers.
 *
 * Signature verification (HMAC-SHA256 over `"${ts}.${rawBody}"`) and a
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
    .update(`${parsed.ts}.${rawBody}`, "utf8")
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
  product_id: string;
  price_id?: string;
  quantity?: number;
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
        grand_total?: number;
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
