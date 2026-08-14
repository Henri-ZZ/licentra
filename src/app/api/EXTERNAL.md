# External API

Endpoints called by **products** (the end-user software that ships with
Licentra's signed license keys) and by **payment providers** (Paddle). No
dashboard session cookie is required — these endpoints authenticate via
the embedded license key value or via Paddle's webhook signature.

**Base URL**: `https://<your-host>` (no separate host in v1).

**Content type**: requests and responses are JSON.

**Common error shape**: `{ "error": "<machine_code>", ... }`.

---

# Part 1 — Product (license) endpoints

These are called by the end-user software that activates / validates a
license. The product ships its signed public key (PEM) and the customer's
license key; the server verifies the key against the database and returns
a signed response that the client verifies against the public key.

**Public key**: distributed out-of-band. The dashboard exposes a
product's public key + fingerprint on the product detail page. The client
embeds the public key at build time and uses it to verify the
`signature` returned by these endpoints.

## Algorithm

Both endpoints take a license key (the customer's copy, e.g.
`ABCD-1234-EFGH-5678`) and return a signed payload:

```json
{
  "valid": true,
  "payload": {
    "product": "stealth-browser-assistant",
    "plan": "standard",
    "license_id": "cmsabc123…",
    "license_expires_at": null,
    "valid_until": "2026-08-14T16:00:00.000Z"
  },
  "signature": "base64-encoded ECDSA-DER signature over JSON.stringify(payload)",
  "certificate": {
    "type": "licentra_license_certificate",
    "version": 1,
    "issuer": "licentra",
    "kid": "licentra-2026-08",
    "license_id": "cmsabc123…",
    "product_id": "stealth-browser-assistant",
    "plan": "standard",
    "status": "active",
    "max_devices": 3,
    "issued_at": 1786700000,
    "expires_at": null,
    "nonce": "…",
    "signature": "base64 Ed25519 signature"
  }
}
```

The client should:
1. Verify `payload.product` matches the bundle's expected product slug.
2. Verify `signature` against the embedded public key using
   ECDSA-P-256 / SHA-256.
3. Check `now < payload.valid_until`. Once past it, the signature is
   stale — go back online to re-verify (so refunds / revocations take
   effect).
4. Treat `valid: false` as "deny" regardless of `reason`.

### Signed License Certificate

The `certificate` field is a **Signed License Certificate** — an Ed25519
signature by Licentra's own signing key proving the License Identity and
state. It is issued on every successful verification and is intended to be
**stored locally** by the client.

Its purpose is **offline migration**: if Licentra is later shut down, the
client can present this certificate to a destination License system, which
verifies it with Licentra's *public* key (no Licentra API call) and issues
a new credential. See `docs/licentra-offline-migration-spec.md`.

- The certificate is a **snapshot** — an old certificate may verify even
  after a revocation. Products that need real-time revocation must keep
  doing online check-ins while Licentra exists.
- `kid` selects which public key to verify with; keys are published at
  `GET /api/v1/well-known/licentra-keys` and retired keys stay listed.
- Verification logic (canonical JSON field order, Ed25519) is frozen and
  versioned (`version: 1`).

#### Verifying a certificate (reference)

Signature validity alone is not enough — check the semantic fields too
(spec §11): `version`, `product_id`, `status`, `expires_at`.

**Canonical serialization (critical).** The Ed25519 signature covers
`JSON.stringify()` of the fields below **in this exact order**,
`signature` excluded. Reordering or including `signature` breaks
verification:

```text
type → version → issuer → kid → license_id → product_id → plan
     → status → max_devices → issued_at → expires_at → nonce
```

Reference implementation (Node; the same logic applies in any language —
Ed25519 verification, key order fixed):

```js
import { createPublicKey, verify as cryptoVerify } from "node:crypto";

// Fetch once and cache by kid: GET /api/v1/well-known/licentra-keys
// (embed at build time if you need fully offline verification).
const PUBLIC_KEYS = {
  "licentra-2026-08": `-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----`,
};

function canonicalBytes(cert) {
  // Field order is frozen — do NOT reorder and do NOT include signature.
  return Buffer.from(JSON.stringify({
    type: cert.type,
    version: cert.version,
    issuer: cert.issuer,
    kid: cert.kid,
    license_id: cert.license_id,
    product_id: cert.product_id,
    plan: cert.plan,
    status: cert.status,
    max_devices: cert.max_devices,
    issued_at: cert.issued_at,
    expires_at: cert.expires_at,
    nonce: cert.nonce,
  }), "utf8");
}

// Returns "ok" or a machine-readable reason.
function verifyCertificate(cert, expectedProductId) {
  if (cert.type !== "licentra_license_certificate") return "wrong_type";
  if (cert.version !== 1) return "unsupported_version";
  const publicKeyPem = PUBLIC_KEYS[cert.kid];
  if (!publicKeyPem) return "unknown_kid"; // rotated / never seen — reject
  const ok = cryptoVerify(
    null, // Ed25519 does its own hashing
    canonicalBytes(cert),
    createPublicKey(publicKeyPem),
    Buffer.from(cert.signature, "base64"),
  );
  if (!ok) return "bad_signature";
  if (cert.product_id !== expectedProductId) return "product_mismatch";
  if (cert.status !== "active") return "bad_status"; // or your policy
  if (cert.expires_at && Date.parse(cert.expires_at) <= Date.now()) {
    return "expired";
  }
  return "ok";
}
```

- **Refresh**: every successful activate/check-in returns a fresh
  certificate — just overwrite the stored copy (spec §19; the refresh
  interval is product-dependent, there is no hard-coded TTL).
- **Migration**: when a destination system asks, present the stored
  certificate; it verifies the same way with Licentra's public key —
  no Licentra API call needed.

**Note on `license_expires_at`**: always `null` in v1. Reserved for future
subscription-expiry support. It is the license's business-level expiry,
distinct from `valid_until` (the signature freshness window).

**Signature validity window**: `valid_until` = issue time +
`product.signatureTtlSeconds` (default 86400 = 24h). While
`now < valid_until`, the client can trust the offline signature; after
that it must hit an endpoint again to fetch a fresh one.

---

### `POST /api/license/activate`

Bind a fingerprint to a license. Idempotent — if the same fingerprint
already exists it just refreshes `lastCheckedAt`. If the license is at
its `maxActivations` cap, the oldest activation is evicted and the new
one is created.

**Request body**
```json
{
  "key": "ABCD-1234-EFGH-5678",
  "fingerprint": "machine-id-or-hash",
  "label": "Alice's MacBook"
}
```

| Field       | Type    | Required | Notes                                    |
|-------------|---------|----------|------------------------------------------|
| key         | string  | yes      | The customer license key                |
| fingerprint | string  | yes      | Stable per-machine identifier           |
| label       | string? | no       | ≤ 120 chars; human-readable device name |

**Responses**
| Status | Body                                                                          |
|--------|-------------------------------------------------------------------------------|
| 200    | `{ valid: true, payload, signature }` OR `{ valid: false, reason }`          |
| 400    | `{ "error": "invalid_json" }` / `{ "error": "invalid_payload", "details": {…} }` |

**`reason` values**: `license_not_found`, `license_revoked`,
`license_refunded` (no `activation_evicted` here — eviction happens
silently and the new fingerprint is bound).

**Side effects**: writes a row in `Activation` (or updates
`lastCheckedAt`), captures `IP` from `X-Forwarded-For` and `User-Agent`
from headers.

### `POST /api/license/check-in`

Heartbeat from the running product. Confirms the fingerprint is still
bound. If the fingerprint was evicted (e.g. user reinstalled on another
machine displacing this one), returns `activation_evicted` so the client
can prompt re-activation.

The client re-checks when the previous signature's `payload.valid_until`
has passed (default 24h — controlled by the product's
`signatureTtlSeconds`).

**Request body**
```json
{
  "key": "ABCD-1234-EFGH-5678",
  "fingerprint": "machine-id-or-hash"
}
```

| Field       | Type    | Required | Notes                                    |
|-------------|---------|----------|------------------------------------------|
| key         | string  | yes      |                                          |
| fingerprint | string  | yes      |                                          |

**Responses**
| Status | Body                                                                       |
|--------|----------------------------------------------------------------------------|
| 200    | `{ valid: true, payload, signature }` OR `{ valid: false, reason }`        |
| 400    | `{ "error": "invalid_json" }` / `{ "error": "invalid_payload", "details": {…} }` |

**`reason` values**: `license_not_found`, `license_revoked`,
`license_refunded`, `activation_evicted` (this fingerprint is no longer
bound — the user must re-activate).

---

# Part 2 — Paddle webhooks

Paddle Billing webhooks are split by event type. Each event has its own
URL — point each Paddle event subscription at its dedicated endpoint.
Delivering a different `event_type` to the wrong URL returns 400
`wrong_event_type` and Paddle will keep retrying (so a misconfiguration
surfaces in the Paddle dashboard instead of silently dropping events).

| Paddle event                | URL                                                |
|-----------------------------|----------------------------------------------------|
| `transaction.completed`     | `POST /api/webhook/paddle-transaction-completed`   |
| `transaction.updated`       | `POST /api/webhook/paddle-transaction-updated`     |

Both endpoints share the same authentication, idempotency, and
`WebhookEvent` recording — only the handler differs.

---

### `POST /api/webhook/paddle-transaction-completed`

Receives the Paddle Billing `transaction.completed` event. Creates the
`Order` + `License` and sends the customer email with the new key.

**Auth**: `Paddle-Signature` header. Format: `ts=<unix-seconds>;h1=<hex>`.
HMAC is computed as `HMAC-SHA256(PADDLE_WEBHOOK_SECRET, "${ts}.${rawBody}")`.
The endpoint rejects signatures with timestamps more than 5 minutes from
server time.

**Idempotency**: every event is keyed by `event_id` in the `WebhookEvent`
table. Re-deliveries of the same event return `{ ok: true, duplicate: true }`
without re-processing.

**Request body** (Paddle Billing `transaction.completed` example)
```json
{
  "event_id": "evt_01h…",
  "event_type": "transaction.completed",
  "occurred_at": "2026-01-15T10:30:00.000Z",
  "data": {
    "id": "txn_01h…",
    "status": "completed",
    "customer_id": "ctm_01h…",
    "custom_data": {
      "productId": "<Licentra Product.cuid>",
      "paddleProductId": "pro_xxx"
    },
    "items": [{ "price_id": "pri_xxx", "quantity": 1 }],
    "customer": {
      "id": "ctm_01h…",
      "email": "buyer@example.com",
      "name": "Buyer Name",
      "locale": "zh-CN"
    },
    "details": {
      "totals": { "grand_total": "2999", "currency_code": "USD" },
      "customer": { "email": "buyer@example.com", "locale": "zh-CN" }
    }
  }
}
```

**Response** — always JSON, status reflects retry advice:
| Status | Body                                       | When                                                  |
|--------|--------------------------------------------|-------------------------------------------------------|
| 200    | `{ "ok": true }`                           | New event processed                                   |
| 200    | `{ "ok": true, "duplicate": true }`        | Event already in `WebhookEvent` (idempotent replay)  |
| 400    | `{ "error": "invalid_json" }`              | Body is not valid JSON after signature check          |
| 400    | `{ "error": "wrong_event_type", ...}`      | Event_type doesn't match this URL (Paddle will retry) |
| 401    | `{ "error": "invalid_signature" }`        | Bad/missing/expired `Paddle-Signature`                |
| 500    | `{ "error": "<message>" }`                 | Handler threw — Paddle will retry                     |

**Product resolution**: the handler reads `custom_data.productId`
(preferred — the Licentra Product.cuid you set in Paddle's checkout
config) and falls back to Paddle's literal `product_id` matching
`Product.paddleProductId`.

**Email template selection**: `data.customer.locale` (Paddle's
checkout locale) is matched against `ProductEmailTemplate.locale` by
`-`-prefix (`"zh-CN"` → `"zh"` template). If no match, falls back to
the product's `isDefault` template (always `en`). The captured locale
is persisted on `Order.locale` and used for any future re-sends.

**Email content**: per-language template from `ProductEmailTemplate`.
`{{xxx}}` placeholders are interpolated at send time:
`{{code}}`, `{{productName}}`, `{{plan}}`, `{{orderId}}`, `{{email}}`,
`{{maxActivations}}`, `{{supportEmail}}`. From-address resolves via
`template.fromAddress ?? <fallback>`.

---

### `POST /api/webhook/paddle-transaction-updated`

Receives the Paddle Billing `transaction.updated` event. Currently
the handler reacts only when the transaction status transitions to a
refunded / canceled / partially_refunded state: the associated `Order`'s
status is synced and any `License` rows tied to that order are
revoked. Other status transitions are recorded in `WebhookEvent` but
silently ignored.

**Auth, idempotency, error responses**: identical to
`paddle-transaction-completed`.

**Request body** (Paddle Billing `transaction.updated` example)
```json
{
  "event_id": "evt_01h…",
  "event_type": "transaction.updated",
  "occurred_at": "2026-01-15T10:31:00.000Z",
  "data": {
    "id": "txn_01h…",
    "status": "refunded",
    "customer_id": "ctm_01h…",
    "custom_data": { "productId": "<Licentra Product.cuid>" }
  }
}
```

**Configuring the webhooks in Paddle**: create two webhook
subscriptions in the Paddle dashboard — one for `transaction.completed`
pointed at `https://<your-host>/api/webhook/paddle-transaction-completed`,
one for `transaction.updated` pointed at
`https://<your-host>/api/webhook/paddle-transaction-updated`. Use
the `PADDLE_WEBHOOK_SECRET` from your `.env.local` as the signing
secret on each.

---

# Part 3 — Migration (public key discovery)

### `GET /api/v1/well-known/licentra-keys`

Licentra's public key discovery endpoint (spec §9). Destination License
systems and offline clients fetch the Ed25519 public key matching a
certificate's `kid` here. **Public and read-only** — no auth.

**Response**
```json
{
  "keys": [
    {
      "kid": "licentra-2026-08",
      "algorithm": "Ed25519",
      "public_key": "-----BEGIN PUBLIC KEY-----\n…",
      "active": true
    }
  ]
}
```

- Keys are listed oldest first; retired keys stay listed with
  `active: false` so certificates issued under an old `kid` remain
  verifiable after rotation.
- Verification procedure for migration partners is documented in
  `docs/licentra-offline-migration-spec.md` §28.
