/**
 * Locale matching + Paddle locale extraction.
 *
 * Licentra stores simplified language codes on ProductEmailTemplate
 * (`en`, `zh`, `ja`) — no region suffix. Paddle sends BCP-47 strings
 * (`en-US`, `zh-CN`). We match by `-`-prefix so a product with a `zh`
 * template still serves a `zh-TW` customer.
 *
 * The default template (always `en` in this product today) is the
 * last-resort fallback.
 */

export const DEFAULT_LOCALE = "en";

export interface TemplateLike {
  locale: string;
  isDefault: boolean;
}

/**
 * Pick the best template for a customer's checkout locale.
 *
 * Resolution order:
 *  1. Exact match on the prefix before any `-` (e.g. Paddle "zh-CN" → "zh").
 *  2. The product's `isDefault` template (typically `en`).
 *
 * Returns `null` only if the caller passed zero templates — the caller
 * is responsible for falling back to legacy product-level fields in
 * that case.
 */
export function pickTemplate<T extends TemplateLike>(
  templates: readonly T[],
  paddleLocale: string | null
): T | null {
  if (paddleLocale) {
    const lang = paddleLocale.split("-")[0].toLowerCase();
    const hit = templates.find((t) => t.locale === lang);
    if (hit) return hit;
  }
  return templates.find((t) => t.isDefault) ?? null;
}

/**
 * Defensively extract a BCP-47 locale from a Paddle webhook payload.
 * Tries the most common paths — exact field placement varies across
 * Paddle versions and event types.
 */
export function extractPaddleLocale(payload: unknown): string | null {
  const p = payload as Record<string, unknown> | null | undefined;
  if (!p) return null;
  const data = p.data as Record<string, unknown> | null | undefined;
  if (!data) return null;

  const candidates = [
    // Paddle Billing transaction.* payloads (most common)
    (data.customer as Record<string, unknown> | undefined)?.locale,
    (data.details as Record<string, unknown> | undefined)?.customer &&
      ((data.details as Record<string, unknown>).customer as Record<string, unknown>).locale,
    // Older / alternative shapes
    (data.customer as Record<string, unknown> | undefined)?.data &&
      (((data.customer as Record<string, unknown>).data as Record<string, unknown>).locale as string | undefined),
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

/**
 * Validate a simplified language code entered by an admin.
 * Accepts 2-3 lowercase ASCII letters: `en`, `zh`, `fil`, etc.
 */
export function isValidLocaleCode(locale: string): boolean {
  return /^[a-z]{2,3}$/.test(locale);
}
