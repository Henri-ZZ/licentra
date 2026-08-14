/**
 * Sign smoke-test: exercises the full license-sign / crypto / fingerprint /
 * certificate pipeline WITHOUT touching the database. Useful as a sanity
 * check during development and to confirm the on-the-wire signature shapes
 * match the specs:
 *
 *   - per-product LicensePayload: ECDSA P-256, DER, base64, "MEUCIQ..." prefix
 *   - Licentra-level Signed License Certificate: Ed25519, canonical JSON
 *   - signed bulk migration export: Ed25519 over the export document
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
import {
  buildCertificatePayload,
  generateEd25519KeyPair,
  signCertificate,
  verifyCertificateSemantics,
  verifyCertificateSignature,
} from "../src/lib/certificate";
import {
  serializeMigrationExport,
  signMigrationExport,
  toExportLicense,
  verifyMigrationExportSignature,
} from "../src/lib/migration-export";

async function main() {
  // --- 1. Per-product ECDSA payload signing (unchanged protocol) ---
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
  const signedAt = new Date();
  const payload = {
    product: product.slug,
    plan: product.plan,
    license_id: licenseId,
    license_expires_at: null,
    valid_until: new Date(signedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };

  const response = buildSignedResponse(payload, product.privateKeyEncrypted);
  console.log("\n--- API response shape (payload + signature) ---");
  console.log(JSON.stringify({ valid: response.valid, payload, signature: response.signature.slice(0, 24) + "…" }, null, 2));

  if (!response.signature.startsWith("MEU")) {
    throw new Error(
      `signature does not start with MEU (DER ECDSA prefix), got "${response.signature.slice(0, 8)}"`
    );
  }
  console.log("✓ Signature is DER-encoded ECDSA (starts with MEU…)");

  const ok = verifyPayload(response.payload, response.signature, publicKeyPem);
  if (!ok) throw new Error("local ECDSA verification failed");
  console.log("✓ Local ECDSA verification passed");

  // --- 2. Signed License Certificate (Ed25519, offline-verifiable) ---
  const { privateKeyPem: edPriv, publicKeyPem: edPub } = generateEd25519KeyPair();
  console.log("\n✓ Generated Ed25519 key pair (kid: licentra-2026-08)");

  const license = {
    id: licenseId,
    plan: "lifetime",
    expiresAt: null,
    maxActivations: 2,
    revoked: false,
    revokedReason: null,
    product: { slug: "sba" },
  };

  const unsigned = buildCertificatePayload(license, {
    kid: "licentra-2026-08",
  });
  const cert = signCertificate(unsigned, edPriv);
  console.log("\n--- Signed License Certificate ---");
  console.log(JSON.stringify(cert, null, 2));

  if (cert.type !== "licentra_license_certificate") {
    throw new Error("certificate type mismatch");
  }
  if (!verifyCertificateSignature(cert, edPub)) {
    throw new Error("certificate signature verification failed");
  }
  console.log("✓ Certificate Ed25519 signature verifies");

  const semantic = verifyCertificateSemantics(cert, {
    publicKeyPem: edPub,
    expectedProductId: "sba",
  });
  if (!semantic.ok) throw new Error(`semantic verification failed: ${semantic.reason}`);
  console.log("✓ Certificate semantic verification passed (product=sba, status=active)");

  // Product binding: a cert for "edit-page" must NOT pass as "sba".
  const otherCert = signCertificate(
    buildCertificatePayload({ ...license, product: { slug: "edit-page" } }, {
      kid: "licentra-2026-08",
    }),
    edPriv
  );
  const wrongProduct = verifyCertificateSemantics(otherCert, {
    publicKeyPem: edPub,
    expectedProductId: "sba",
  });
  if (wrongProduct.ok) throw new Error("product binding check failed");
  console.log("✓ Product binding enforced (edit-page cert rejected for sba)");

  // --- 3. Signed bulk migration export (Ed25519 over the document) ---
  const exportDoc = signMigrationExport(
    {
      type: "licentra_license_migration_export",
      version: 1,
      issuer: "licentra",
      export_id: "mig_test_1",
      created_at: Math.floor(Date.now() / 1000),
      destination_system: "new-license-system",
      licenses: [
        toExportLicense({ ...license, createdAt: new Date() }),
        toExportLicense({
          ...license,
          id: "lic_second",
          revoked: true,
          revokedReason: "refunded",
          createdAt: new Date(),
        }),
      ],
      kid: "licentra-2026-08",
    },
    edPriv
  );
  console.log("\n--- Signed migration export (abridged) ---");
  console.log(JSON.stringify(
    { ...exportDoc, licenses: exportDoc.licenses, signature: exportDoc.signature.slice(0, 16) + "…" },
    null,
    2
  ));

  if (!verifyMigrationExportSignature(exportDoc, edPub)) {
    throw new Error("export signature verification failed");
  }
  console.log("✓ Migration export Ed25519 signature verifies");

  // Deterministic canonical serialization (same doc → same bytes).
  const a = serializeMigrationExport(exportDoc);
  const b = serializeMigrationExport(JSON.parse(JSON.stringify(exportDoc)));
  if (a !== b) throw new Error("canonical serialization is not deterministic");
  console.log("✓ Canonical serialization is deterministic");

  // --- 4. License key format ---
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
