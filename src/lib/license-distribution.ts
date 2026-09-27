import { z } from "zod";

/**
 * Distribution channel of the client artifact that called a license endpoint.
 *
 * Build-owned: every store artifact embeds its own value at build time (Edit
 * Page does it in scripts/package.sh via telemetry-distribution.js), so the
 * channel can never be inferred from the runtime browser — an Edge user may
 * have installed from the Chrome Web Store.
 *
 * Optional everywhere because clients predating the field omit it. Shared by
 * `/api/license/activate` and `/api/license/check-in` so the two contracts can
 * never drift apart.
 */
export const DISTRIBUTIONS = [
  "chrome_web_store",
  "edge_addons",
  "direct",
  "development",
] as const;

export const distributionSchema = z.enum(DISTRIBUTIONS).optional();
