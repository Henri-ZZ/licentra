/**
 * One-shot data migration: backfill an `en` ProductEmailTemplate row for
 * every existing Product. Idempotent — products that already have an `en`
 * template are skipped. Uses the canonical default template from
 * `src/lib/email-default-template.ts` as seed data.
 *
 * Usage: `pnpm backfill:templates`
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

import {
  DEFAULT_EMAIL_BODY_HTML,
  DEFAULT_EMAIL_SUBJECT,
} from "../src/lib/email-default-template";

// Mirror prisma.config.ts: load .env.local so DATABASE_URL is set when
// running under `tsx`. Prisma's own env loading doesn't help here because
// envSchema in src/lib/env.ts isn't executed in the script context.
function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvLocal();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Add it to .env.local before running the backfill."
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: databaseUrl }),
});

async function main() {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      slug: true,
      templates: {
        where: { locale: "en" },
        select: { id: true },
      },
    },
  });

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const p of products) {
    if (p.templates.length > 0) {
      skipped++;
      continue;
    }
    try {
      await prisma.productEmailTemplate.create({
        data: {
          productId: p.id,
          locale: "en",
          displayName: "English",
          isDefault: true,
          subject: DEFAULT_EMAIL_SUBJECT,
          bodyHtml: DEFAULT_EMAIL_BODY_HTML,
        },
      });
      created++;
      console.log(`  + en template created for product ${p.slug}`);
    } catch (err) {
      failed++;
      console.error(
        `  ! failed to backfill product ${p.slug}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  console.log(
    `\nBackfill complete: ${created} created, ${skipped} skipped (already had en), ${failed} failed, ${products.length} total`
  );
}

main()
  .catch((err) => {
    console.error("Backfill crashed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
