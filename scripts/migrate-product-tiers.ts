/**
 * One-shot backfill: create a ProductPriceTier for each existing Product
 * and attach existing LicenseKey rows to that tier.
 *
 * Idempotent. Safe to re-run; rows that already exist are skipped.
 *
 *   1. For each Product, create one ProductPriceTier:
 *        plan          = "standard"             (the old schema's default —
 *                                               we can't recover the
 *                                               original value because
 *                                               Product.plan was removed
 *                                               in the same migration;
 *                                               admin can rename from the
 *                                               dashboard)
 *        paddlePriceId = null                   (can't recover original
 *                                               value either; admin
 *                                               fills in from Paddle)
 *        expiresInDays = null                   (everything pre-migration
 *                                               is treated as lifetime)
 *
 *      Products with no `paddleProductId` set are skipped — those rows are
 *      not sellable on Paddle and admin must add a tier manually.
 *
 *   2. For each LicenseKey whose productId maps to a (now existing) tier,
 *      set tierId = the new tier's id, plan = tier.plan, expiresAt = null.
 *
 * Run with:
 *   pnpm backfill:tiers
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const products = await prisma.product.findMany({
    include: { priceTiers: true },
  });

  let tierCreated = 0;
  let tierSkipped = 0;
  let licenseUpdated = 0;

  for (const product of products) {
    if (!product.paddleProductId) {
      tierSkipped++;
      console.log(
        `skip product ${product.slug} — paddleProductId is null, no tier to migrate`,
      );
      continue;
    }

    if (product.priceTiers.length > 0) {
      tierSkipped++;
      console.log(
        `skip product ${product.slug} — already has ${product.priceTiers.length} tier(s)`,
      );
      continue;
    }

    const tier = await prisma.productPriceTier.create({
      data: {
        productId: product.id,
        plan: "standard",
        paddlePriceId: null,
        expiresInDays: null,
      },
    });
    tierCreated++;
    console.log(
      `created tier ${tier.id} (plan="standard") for product ${product.slug}`,
    );

    const result = await prisma.licenseKey.updateMany({
      where: { productId: product.id, tierId: null },
      data: {
        tierId: tier.id,
        plan: tier.plan,
        expiresAt: null,
      },
    });
    licenseUpdated += result.count;
    console.log(`  attached ${result.count} license(s) to tier ${tier.id}`);
  }

  console.log("\n--- summary ---");
  console.log(`products scanned:    ${products.length}`);
  console.log(`tiers created:       ${tierCreated}`);
  console.log(`tiers skipped:       ${tierSkipped}`);
  console.log(`licenses backfilled: ${licenseUpdated}`);
  console.log(
    "\nNOTE: every migrated tier is named 'standard' with no paddlePriceId —\n" +
      "open each product in the dashboard and rename / fill in Paddle price IDs.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());