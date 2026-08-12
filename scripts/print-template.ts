/**
 * Helper: print template subject + body for a product by id.
 * Usage: pnpm tsx scripts/print-template.ts <productId> [locale]
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
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
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

const [productId, locale] = process.argv.slice(2);
if (!productId) {
  console.error("usage: tsx scripts/print-template.ts <productId> [locale]");
  process.exit(2);
}
const url = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: url }),
});

prisma.productEmailTemplate
  .findFirst({
    where: { productId, locale: locale ?? "en" },
  })
  .then((t) => {
    if (!t) {
      console.log("not found");
      return;
    }
    console.log(`locale: ${t.locale}`);
    console.log(`isDefault: ${t.isDefault}`);
    console.log(`displayName: ${t.displayName}`);
    console.log(`fromAddress: ${t.fromAddress ?? "(null)"}`);
    console.log("subject:", t.subject);
    console.log("bodyHtml:", t.bodyHtml);
  })
  .finally(() => prisma.$disconnect());
