# Licentra

A license-key sales & activation platform. Customers pay through Paddle, the
service signs a per-product payload with ECDSA P-256, and customer apps
verify locally with a public key embedded in their code. Clients check
back with a periodic `/api/license/check-in` to detect revocations, refunds,
and the FIFO eviction of their activation slot.

## Stack

- **Next.js 16** (App Router, Turbopack) + TypeScript
- **Prisma 7** + Neon Postgres (`@prisma/adapter-neon`)
- **Tailwind v4** + shadcn/ui (New York, neutral)
- **Paddle Billing** for payments, **Resend** for transactional email
- **jose** for JWT, **zod** for input validation
- **ECDSA P-256** (SHA-256, DER, base64) for license payload signatures
- **AES-256-GCM** for at-rest encryption of product private keys

## Quick start

```bash
pnpm install
cp .env.example .env.local   # edit secrets
pnpm prisma generate
pnpm dev
```

Open <http://localhost:3000>; you'll be redirected to `/login`. Default
admin credentials (for development only) are in `src/lib/env.ts`:

## Configuration

All environment variables are validated at startup by `src/lib/env.ts`
(see `.env.example` for the full list). Defaults are baked in so the
app boots without a real `.env.local`, but **production must override
every secret**.

### Neon Postgres

1. Create a project at <https://neon.tech>.
2. Copy the connection string to `DATABASE_URL`.
3. Apply the schema:

```bash
pnpm prisma migrate deploy
# or for dev:
pnpm prisma db push
```

### Paddle Billing

1. Create the product(s) and price(s) in your Paddle dashboard.
2. Set `PADDLE_WEBHOOK_SECRET` (from Developer tools → Notifications).
3. In Paddle, point each webhook at its dedicated URL and subscribe:
   - `transaction.completed` → `https://YOUR-DOMAIN/api/webhook/paddle-transaction-completed`
   - `transaction.updated` → `https://YOUR-DOMAIN/api/webhook/paddle-transaction-updated`
4. In Licentra, create a Product and paste the Paddle product/price IDs.

The webhook handler also reads `custom_data.productId` from Paddle
transactions — set this in your checkout integration to the Licentra
Product id for a more reliable link than the Paddle product id.

### Resend

1. Get an API key at <https://resend.com>.
2. Set `RESEND_API_KEY`.
3. Verify the "from" domain you set per product (e.g. `noreply@henri.ren`).

Licentra falls back to a console-stub when `RESEND_API_KEY` starts with
`re_dev`, so you can develop without burning real email quota.

## API

All license endpoints accept and return JSON. The license key itself is
the credential — there is no separate API key.

### `POST /api/license/activate`

```json
{
  "key": "K3PQ-W7HN-8YJZ-V9D2",
  "fingerprint": "device-uuid-or-hash",
  "label": "MacBook Pro"
}
```

If the fingerprint is already bound, this is a no-op refresh. If the
license is at its `maxActivations`, the **oldest** activation is evicted
(FIFO) and the new one takes its slot.

### `POST /api/license/check-in`

```json
{
  "key": "...",
  "fingerprint": "..."
}
```

Refreshes `lastCheckedAt` and returns the signed payload. Returns
`{valid: false, reason}` if the license has been revoked, refunded, or
this fingerprint was evicted.

The client re-checks whenever the previous signature's `payload.valid_until`
has passed (default 24h).

## Signed payload

Success response shape:

```json
{
  "valid": true,
  "payload": {
    "product": "stealth-browser-assistant",
    "plan": "pro",
    "license_id": "abc123",
    "license_expires_at": null,
    "valid_until": "2026-08-14T16:00:00.000Z"
  },
  "signature": "MEUCIQ...",
  "certificate": {
    "type": "licentra_license_certificate",
    "version": 1,
    "issuer": "licentra",
    "kid": "licentra-2026-08",
    "license_id": "abc123",
    "product_id": "stealth-browser-assistant",
    "plan": "pro",
    "status": "active",
    "max_devices": 3,
    "issued_at": 1786700000,
    "expires_at": null,
    "nonce": "...",
    "signature": "base64 Ed25519 signature"
  }
}
```

The `signature` is ECDSA P-256 over `JSON.stringify(payload)`, hashed with
SHA-256, encoded as DER, then base64. Each product has its own key pair;
the client picks the public key by `payload.product`.

The `certificate` is a **Signed License Certificate** — Ed25519-signed by
Licentra's own key, proving the License Identity and state. Clients store
it locally so they can migrate to a future License system offline (see
`docs/licentra-offline-migration-spec.md`). Its public keys are published
at `GET /api/v1/well-known/licentra-keys`.

### Client verification (reference)

```js
import { createPublicKey, verify as cryptoVerify } from "node:crypto";

const PUBLIC_KEYS = {
  "stealth-browser-assistant": `-----BEGIN PUBLIC KEY-----
...your PEM...
-----END PUBLIC KEY-----`,
};

function verifyLicense(response) {
  const { payload, signature } = response;
  const publicKeyPem = PUBLIC_KEYS[payload.product];
  if (!publicKeyPem) return false;

  const ok = cryptoVerify(
    "sha256",
    Buffer.from(JSON.stringify(payload), "utf8"),
    createPublicKey(publicKeyPem),
    Buffer.from(signature, "base64"),
  );
  return ok;
}
```

> **JSON serialisation caveat**: `JSON.stringify` must produce identical
> bytes on both server and client. V8 preserves insertion order, so the
> server-side key order (`product → plan → license_id → license_expires_at → valid_until`) is
> what determines the canonical bytes.

> **Certificate verification (reference)**: the Ed25519 verification for
> `certificate` — including its canonical field order and semantic checks
> (`product_id`, `status`, `expires_at`, `version`, `kid`) — is documented
> with runnable code in `src/app/api/EXTERNAL.md` → "Signed License
> Certificate → Verifying a certificate (reference)". Store the certificate
> from each successful activate/check-in response for offline migration.

## Security model

- **License keys** are 16 chars from a 32-symbol alphabet (≈95 bits of
  entropy). Stored only as SHA-256 hashes. Original key is delivered once
  via email.
- **Webhook auth** is HMAC-SHA256 over `${ts}.${rawBody}`; timestamp
  must be within ±5 minutes.
- **Dashboard auth** is HS256 JWT in an `httpOnly` cookie, plus **TOTP
  two-factor authentication** (RFC 6238, 6-digit, 30s): after the
  password step, a 6-digit code from your authenticator app is required.
  The TOTP secret is stored encrypted (AES-GCM) in the `AppSetting`
  table; `pnpm bootstrap:2fa` generates the secret + QR. The single user
  is hardcoded in env for now — swap `verifyCredentials` to a Prisma
  lookup when you add a User table.
- **Signing keys** are ECDSA P-256, generated per product. Public keys
  are visible in the dashboard; private keys are AES-256-GCM encrypted
  with `LICENSE_MASTER_KEY` before being persisted.
- **Fingerprints** are hashed before storage so a DB leak doesn't
  expose raw device identifiers.
- **Migration** does not depend on Licentra staying online: every
  successful verification returns a Signed License Certificate (Ed25519)
  the client stores locally; an admin-only `POST /api/v1/migration/export`
  produces a signed bulk export. Destination systems verify both with
  Licentra's public keys from `GET /api/v1/well-known/licentra-keys`.
  License ID is the permanent identity — rotating a License Key updates
  the hash in place and never creates a new License row or drops device
  activations.

### Two-factor authentication (dashboard)

- Enabled via `pnpm bootstrap:2fa` — prints the otpauth URI, the base32
  secret, and saves a QR PNG to `./totp-setup-qr.png` (delete the PNG
  after scanning; it contains the secret). `--rotate` issues a fresh
  secret (all previously issued codes stop working).
- Login is two-step: password → 6-digit TOTP code (RFC 6238, 30s). If no
  secret is configured, the first login forces `/setup-2fa` so you can
  scan a new QR before getting a session.
- **Lost your authenticator?** Delete the `admin_totp_secret` row from
  the `AppSetting` table (e.g.
  `DELETE FROM "AppSetting" WHERE key = 'admin_totp_secret';`). The next
  login will then force the setup flow again and you can register a new
  device. Note: anyone with database access can do this — acceptable for
  a single-admin dashboard; a multi-user deployment should add per-user
  recovery codes instead.

## Migration

See `docs/licentra-offline-migration-spec.md` for the full protocol. The
short version:

```text
License Key      → credential (only its SHA-256 is stored)
License ID       → permanent identity (License.id, never changes)
Signed Certificate → portable proof (Ed25519, verifiable offline)
```

- **Certificate issuance** is part of normal activate/check-in — no extra
  call needed.
- **Public keys** (including retired ones after rotation) are served at
  `GET /api/v1/well-known/licentra-keys`.
- **Bulk export** (`POST /api/v1/migration/export`, admin session + rate
  limited) returns one signed document covering all License state.
- **Key rotation** (`POST /api/licenses/[id]/resend-email`) rotates the
  credential hash in place — the License Identity and device activations
  are preserved.

## Smoke test

```bash
pnpm tsx scripts/smoke-sign.ts
```

Verifies (without a database) that the licensing pipeline produces a
correctly-shaped signed response and that the same keys can verify it —
including the Ed25519 certificate and signed migration export.
Should print `🎉 All smoke checks passed.`

## Not in scope (yet)

- Multi-user / role auth
- License API rate limiting (recommend Upstash Redis in production)
- Webhook retry UI (dashboard shows last error per event)
- Email templates live preview
- Migration import UI / migration dashboard (import is destination-side;
  Licentra only exports)
- Test suite (build currently passes; recommend Vitest + Playwright)
