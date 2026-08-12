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
3. In Paddle, point the webhook at `https://YOUR-DOMAIN/api/webhook/paddle`
   and subscribe to `transaction.completed` and `transaction.updated`.
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

### `POST /api/license/validate`

```json
{ "key": "K3PQ-W7HN-8YJZ-V9D2" }
```

Returns either the signed payload or `{ "valid": false }`.

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
  "fingerprint": "...",
  "client_version": "1.2.3",
  "platform": "macos"
}
```

Refreshes `lastCheckedAt` and returns the signed payload. Returns
`{valid: false, reason}` if the license has been revoked, refunded, or
this fingerprint was evicted.

Always run this every 24–72 hours (server tells you the next interval in
`next_check_in_seconds`).

### `POST /api/license/deactivate`

```json
{ "key": "...", "fingerprint": "..." }
```

Removes the fingerprint binding. Idempotent.

## Signed payload

Success response shape:

```json
{
  "valid": true,
  "payload": {
    "product": "stealth-browser-assistant",
    "plan": "pro",
    "license_id": "abc123",
    "expires_at": null
  },
  "signature": "MEUCIQ..."
}
```

The signature is ECDSA P-256 over `JSON.stringify(payload)`, hashed with
SHA-256, encoded as DER, then base64. Each product has its own key pair;
the client picks the public key by `payload.product`.

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
> server-side key order (`product → plan → license_id → expires_at`) is
> what determines the canonical bytes.

## Security model

- **License keys** are 16 chars from a 32-symbol alphabet (≈95 bits of
  entropy). Stored only as SHA-256 hashes. Original key is delivered once
  via email.
- **Webhook auth** is HMAC-SHA256 over `${ts}.${rawBody}`; timestamp
  must be within ±5 minutes.
- **Dashboard auth** is HS256 JWT in an `httpOnly` cookie. The single
  user is hardcoded in env for now — swap `verifyCredentials` to a
  Prisma lookup when you add a User table.
- **Signing keys** are ECDSA P-256, generated per product. Public keys
  are visible in the dashboard; private keys are AES-256-GCM encrypted
  with `LICENSE_MASTER_KEY` before being persisted.
- **Fingerprints** are hashed before storage so a DB leak doesn't
  expose raw device identifiers.

## Smoke test

```bash
pnpm tsx scripts/smoke-sign.ts
```

Verifies (without a database) that the licensing pipeline produces a
correctly-shaped signed response and that the same keys can verify it.
Should print `🎉 All smoke checks passed.`

## Not in scope (yet)

- Multi-user / role auth
- License API rate limiting (recommend Upstash Redis in production)
- Webhook retry UI (dashboard shows last error per event)
- Email templates live preview
- Audit log for activation events
- Test suite (build currently passes; recommend Vitest + Playwright)
