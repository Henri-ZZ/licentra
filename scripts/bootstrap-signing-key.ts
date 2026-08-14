/**
 * Provision (or rotate) the Licentra Ed25519 signing key used for Signed
 * License Certificates and migration exports.
 *
 * The key is stored in the SigningKey table, private half encrypted with
 * LICENSE_MASTER_KEY. Rotating retires the current key (kept in the table
 * so old certificates stay verifiable) and issues a fresh one.
 *
 * Usage:
 *   pnpm tsx scripts/bootstrap-signing-key.ts          # ensure active key
 *   pnpm tsx scripts/bootstrap-signing-key.ts --rotate # retire + new key
 */
import {
  ensureActiveSigningKey,
  getActiveSigningKey,
  rotateSigningKey,
} from "../src/lib/certificate";
import { prisma } from "../src/lib/prisma";

async function main() {
  const rotate = process.argv.includes("--rotate");

  if (rotate) {
    const current = await getActiveSigningKey();
    if (!current) {
      console.log("No active signing key — creating one instead of rotating.");
    } else {
      console.log(`Retiring active key ${current.kid}…`);
    }
  }

  const key = rotate
    ? await rotateSigningKey()
    : await ensureActiveSigningKey();

  console.log("\n--- Active Licentra signing key ---");
  console.log(`kid:        ${key.kid}`);
  console.log(`algorithm:  ${key.algorithm}`);
  console.log(`created_at: ${key.createdAt.toISOString()}`);
  console.log(`active:     ${key.active}`);

  const all = await prisma.signingKey.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`\nTotal keys kept (active + retired): ${all.length}`);
  console.log("Public keys are served at GET /api/v1/well-known/licentra-keys");
  console.log("\n⚠️  The private key never leaves the server; it is encrypted at rest.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
