import { z } from "zod";

/**
 * Distribution channel of the client artifact that called a license endpoint.
 *
 * Build-owned: every store artifact embeds its own value at build time (Edit
 * Page does it in scripts/package.sh via telemetry-distribution.js), so the
 * channel can never be inferred from the runtime browser — an Edge user may
 * have installed from the Chrome Web Store.
 *
 * Optional everywhere because clients predating the field omit it. The value
 * is intentionally not an enum: products own their build channel names (for
 * example `cws` or `edge`) and may introduce new ones independently of
 * Licentra. Shared by `/api/license/activate` and `/api/license/check-in` so
 * the two contracts can never drift apart.
 */
export const MAX_DISTRIBUTION_LENGTH = 32;

export const distributionSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_DISTRIBUTION_LENGTH)
  .optional();
