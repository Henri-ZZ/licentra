/**
 * Sign smoke-test: exercises the full license-sign / crypto / fingerprint
 * pipeline without touching the database. Useful as a sanity check
 * during development and to confirm the on-the-wire signature shape
 * matches the spec (DER ECDSA, base64, "MEUCIQ..." prefix).
 *
 * Run: pnpm tsx scripts/smoke-sign.ts
 */
import { generateLicenseKey, sha256Hex } from "../src/lib/license-key";
import { encrypt, decrypt } from "../src/lib/crypto";
import {
  buildSignedResponse,
  generateKeyPair,
  verifyPayload,
} from "../src/lib/license-sign";
import { publicKeyFingerprint } from "../src/lib/fingerprint";

async function main() {
  const { privateKeyPem, publicKeyPem } = generateKeyPair();
  console.log("✓ Generated ECDSA P-256 key pair");

  const fingerprint = publicKeyFingerprint(publicKeyPem);
  console.log(`✓ Public key fingerprint: ${fingerprint}`);

  const encrypted = encrypt(privateKeyPem);
  const decrypted = decrypt(encrypted);
  if (decrypted !== privateKeyPem) {
    throw new Error("AES-256-GCM round-trip failed");
  }
  console.log("✓ AES-256-GCM round-trip ok");

  const product = {
    slug: "stealth-browser-assistant",
    plan: "pro",
    privateKeyEncrypted: encrypted,
  };

  const licenseId = `lic_${Date.now().toString(36)}`;
  const payload = {
    product: product.slug,
    plan: product.plan,
    license_id: licenseId,
    expires_at: null,
  };

  const response = buildSignedResponse(
    payload,
    product.privateKeyEncrypted
  );
  console.log("\n--- API response shape ---");
  console.log(JSON.stringify(response, null, 2));

  // DER signatures for ECDSA P-256 always start with 0x30 (SEQUENCE) — the
  // expanded form is `MEU` followed by either `C` (32-byte r, no leading
  // zero) or `CIQ` (33-byte r with leading zero). Both are valid; the
  // exact prefix depends on the random r value.
  if (!response.signature.startsWith("MEU")) {
    throw new Error(
      `signature does not start with MEU (DER ECDSA prefix), got "${response.signature.slice(0, 8)}"`
    );
  }
  console.log("\n✓ Signature is DER-encoded ECDSA (starts with MEU…)");

  const ok = verifyPayload(response.payload, response.signature, publicKeyPem);
  if (!ok) throw new Error("local verification failed");
  console.log("✓ Local ECDSA verification passed");

  const rawKey = generateLicenseKey();
  console.log(`\n✓ Generated sample key: ${rawKey}`);
  console.log(`  SHA-256 hash: ${sha256Hex(rawKey)}`);
  console.log(`  Format regex: ${/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(rawKey) ? "ok" : "BAD"}`);

  console.log("\n🎉 All smoke checks passed.");
}

main().catch((err) => {
  console.error("\n❌ smoke test failed:", err);
  process.exit(1);
});
