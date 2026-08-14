# Dashboard / Frontend API

Endpoints the Licentra admin dashboard calls. All endpoints require a
session cookie set by `POST /api/auth/login`. The cookie is HTTP-only and
issued by `createSessionCookie()` in `src/lib/auth.ts`.

**Base URL**: same origin as the dashboard (no separate host in v1).

**Auth**: every endpoint below returns `401 { "error": "unauthorized" }`
when the session cookie is missing or invalid.

**Content type**: requests and responses are JSON unless noted.

**Error shape**: errors return `{ "error": "<machine_code>", ... }`.
Successful responses include the data inline (e.g. `{ ok: true, product }`)
or as a typed object.

---

## Auth

### `POST /api/auth/login`

Sign in. Sets the session cookie on success.

**Request body**
```json
{ "email": "you@example.com", "password": "…" }
```

**Responses**
| Status | Body                                  | Notes                          |
|--------|---------------------------------------|--------------------------------|
| 200    | `{ "ok": true }`                      | Sets `licentra_session` cookie |
| 400    | `{ "error": "invalid_json" }`         | Body wasn't JSON               |
| 400    | `{ "error": "invalid_payload", … }`   | Missing/invalid fields         |
| 401    | `{ "error": "invalid_credentials" }`  | Wrong email or password        |

### `POST /api/auth/logout`

Clears the session cookie. No body.

**Responses**
| Status | Body             |
|--------|------------------|
| 200    | `{ "ok": true }` |

---

## Products

### `POST /api/products`

Create a new product. Atomically creates a `Product` row, a default
`en` `ProductEmailTemplate` row, and one or more `ProductPriceTier`
rows in one transaction. Slug must be unique; each tier's `plan` must
be unique within the product; each tier's `paddlePriceId` (if set)
must be unique within the product.

**Request body**
```json
{
  "name": "Stealth Browser Assistant",
  "slug": "stealth-browser-assistant",
  "description": "Optional",
  "paddleProductId": "pro_xxx",
  "maxActivations": 3,
  "active": true,
  "supportEmail": "support@henri.ren",
  "tiers": [
    { "plan": "永久", "paddlePriceId": "pri_xxx" }
  ]
}
```

| Field           | Type     | Required | Notes                                  |
|-----------------|----------|----------|----------------------------------------|
| name            | string   | yes      | 1–120 chars                            |
| slug            | string   | yes      | `[a-z0-9-]+`, 1–60 chars, unique       |
| description     | string?  | no       | ≤ 2000 chars                           |
| paddleProductId | string?  | no       | Paddle product ID, ≤ 120 chars         |
| maxActivations  | number   | no       | 1–100, default 3                       |
| active          | boolean  | no       | default `true`                         |
| supportEmail    | string?  | no       | Email; substituted into `{{supportEmail}}` |
| tiers           | array    | yes      | 1–20 items; see below                  |

`tiers[]`:
| Field        | Type    | Required | Notes                                          |
|--------------|---------|----------|------------------------------------------------|
| plan         | string  | yes      | 1–40 chars; unique per product                 |
| paddlePriceId| string? | no       | ≤ 120 chars; unique per product when set       |

`expiresInDays` is **not** part of this request — every tier is created
with `expiresInDays: null` (lifetime). See `docs/plans/price-tiers.md`.

**Responses**
| Status | Body                                                    | Notes                                     |
|--------|---------------------------------------------------------|-------------------------------------------|
| 200    | `{ "ok": true, "product": Product }`                    | Created                                   |
| 400    | `{ "error": "invalid_json" }`                           |                                           |
| 400    | `{ "error": "invalid_payload", "details": {…} }`        | Zod field errors in `details.fieldErrors` |
| 401    | `{ "error": "unauthorized" }`                           |                                           |
| 409    | `{ "error": "slug_already_exists" }`                    | Slug collision                            |
| 409    | `{ "error": "plan_already_exists" }`                    | `tiers[].plan` collision                  |
| 409    | `{ "error": "paddlePriceId_already_exists" }`           | `tiers[].paddlePriceId` collision         |

### `PATCH /api/products/[id]`

Update product fields. All fields optional; only provided fields change.
Plan / price-tier fields live on `ProductPriceTier` and are managed via
`/api/products/[id]/tiers` — see below.

**Path params**: `id` (Product id)

**Request body** (any subset)
```json
{
  "name": "…",
  "description": "…" | null,
  "paddleProductId": "…" | null,
  "maxActivations": 3,
  "active": true,
  "supportEmail": "support@henri.ren" | null
}
```

**Responses**
| Status | Body                                       |
|--------|--------------------------------------------|
| 200    | `{ "ok": true, "product": Product }`       |
| 400    | `{ "error": "invalid_json" }`              |
| 400    | `{ "error": "invalid_payload", "details": {…} }` |
| 401    | `{ "error": "unauthorized" }`              |
| 404    | `{ "error": "not_found" }`                 |

### `DELETE /api/products/[id]`

Delete a product. Refuses if any License rows exist for it (revoke or
delete those first).

**Responses**
| Status | Body                                       |
|--------|--------------------------------------------|
| 200    | `{ "ok": true }`                           |
| 401    | `{ "error": "unauthorized" }`              |
| 404    | `{ "error": "not_found" }`                 |
| 409    | `{ "error": "product_has_licenses" }`      |

### `POST /api/products/[id]/generate-key`

Generate (or rotate) the product's ECDSA P-256 signing key pair. Stores
the private key encrypted under `LICENSE_MASTER_KEY`; returns the public
key (PEM) and its fingerprint for client distribution. Any previously
signed licenses are invalidated.

**Path params**: `id` (Product id)

**Request body**: none.

**Responses**
| Status | Body                                                                  |
|--------|-----------------------------------------------------------------------|
| 200    | `{ "ok": true, "publicKey": "PEM", "publicKeyFingerprint": "hex" }`   |
| 400    | `{ "error": "invalid_params" }`                                       |
| 401    | `{ "error": "unauthorized" }`                                          |
| 404    | `{ "error": "not_found" }`                                             |

---

## Email templates (per product)

### `POST /api/products/[id]/templates`

Add a non-default language template. The `en` default is created with the
product and can only be edited (see PATCH below) — POSTing `en` returns 409.

**Path params**: `id` (Product id)

**Request body**
```json
{
  "locale": "zh",
  "displayName": "简体中文",
  "fromAddress": "noreply@henri.ren",
  "subject": "Your {{productName}} License Key",
  "bodyHtml": "<p>…</p>"
}
```

| Field        | Type    | Required | Notes                                                    |
|--------------|---------|----------|----------------------------------------------------------|
| locale       | string  | yes      | 2–3 lowercase letters; regex `^[a-z]{2,3}$`               |
| displayName  | string  | yes      | 1–64 chars (e.g. "简体中文")                              |
| fromAddress  | string? | no       | ≤ 200 chars; null → Resend dev fallback at send time     |
| subject      | string  | yes      | 1–200 chars                                              |
| bodyHtml     | string  | yes      | 1–20000 chars                                            |

**Responses**
| Status | Body                                                  | Notes                                |
|--------|-------------------------------------------------------|--------------------------------------|
| 200    | `{ "ok": true, "template": ProductEmailTemplate }`    |                                      |
| 400    | `{ "error": "invalid_params" \| "invalid_json" \| "invalid_payload", … }` | |
| 401    | `{ "error": "unauthorized" }`                         |                                      |
| 404    | `{ "error": "not_found" }`                            |                                      |
| 409    | `{ "error": "english_template_already_exists" }`      | `locale === "en"`                    |
| 409    | `{ "error": "locale_already_exists" }`                | Same `(productId, locale)` exists    |

### `PATCH /api/products/[id]/templates/[tid]`

Edit a template. The `locale` field is **not** editable — to "rename" a
locale, DELETE and POST a new one. The `en` row's `isDefault` cannot be
flipped (no API path allows it).

**Path params**: `id` (Product id), `tid` (Template id)

**Request body** (any subset)
```json
{
  "displayName": "简体中文",
  "fromAddress": "…" | null,
  "subject": "…",
  "bodyHtml": "…"
}
```

**Responses**
| Status | Body                                            |
|--------|-------------------------------------------------|
| 200    | `{ "ok": true, "template": ProductEmailTemplate }` |
| 400    | `{ "error": "invalid_params" \| "invalid_json" \| "invalid_payload", … }` |
| 401    | `{ "error": "unauthorized" }`                   |
| 404    | `{ "error": "not_found" }`                      |

### `DELETE /api/products/[id]/templates/[tid]`

Delete a template. The default `en` row cannot be deleted (edit it
instead).

**Path params**: `id` (Product id), `tid` (Template id)

**Responses**
| Status | Body                                            |
|--------|-------------------------------------------------|
| 200    | `{ "ok": true }`                                |
| 400    | `{ "error": "invalid_params" }`                 |
| 400    | `{ "error": "cannot_delete_default_template" }` | when `tid` is the `en` row |
| 401    | `{ "error": "unauthorized" }`                   |
| 404    | `{ "error": "not_found" }`                      |

---

## Price tiers (per product)

A product can have multiple `ProductPriceTier` rows, each one represents
a plan the customer can buy (e.g. `30天`, `一年`, `永久`). See
`docs/plans/price-tiers.md` for the design.

### `POST /api/products/[id]/tiers`

Add a new tier. Refuses with 409 if the `plan` or `paddlePriceId` is
already used by another tier on the same product. `expiresInDays` is
**not** part of this request — every new tier is created at `null`
(lifetime) until timed plans are enabled.

**Path params**: `id` (Product id)

**Request body**
```json
{
  "plan": "一年",
  "paddlePriceId": "pri_yyy"
}
```

| Field         | Type    | Required | Notes                                       |
|---------------|---------|----------|---------------------------------------------|
| plan          | string  | yes      | 1–40 chars; unique per product              |
| paddlePriceId | string? | no       | ≤ 120 chars; unique per product when set    |

**Responses**
| Status | Body                                                | Notes                                |
|--------|-----------------------------------------------------|--------------------------------------|
| 200    | `{ "ok": true, "tier": ProductPriceTier }`          |                                      |
| 400    | `{ "error": "invalid_params" \| "invalid_json" \| "invalid_payload", … }` | |
| 401    | `{ "error": "unauthorized" }`                       |                                      |
| 404    | `{ "error": "not_found" }`                          |                                      |
| 409    | `{ "error": "plan_already_exists" }`                | `plan` collision                     |
| 409    | `{ "error": "paddlePriceId_already_exists" }`       | `paddlePriceId` collision            |

### `PATCH /api/products/[id]/tiers/[tid]`

Edit a tier. `expiresInDays` is intentionally absent — it is locked at
`null` (lifetime) until timed plans are enabled. To change expiry,
create a new tier and migrate licenses over.

**Path params**: `id` (Product id), `tid` (PriceTier id)

**Request body** (any subset)
```json
{
  "plan": "一年",
  "paddlePriceId": "pri_yyy"
}
```

**Responses**
| Status | Body                                       |
|--------|--------------------------------------------|
| 200    | `{ "ok": true, "tier": ProductPriceTier }` |
| 400    | `{ "error": "invalid_params" \| "invalid_json" \| "invalid_payload", … }` |
| 401    | `{ "error": "unauthorized" }`              |
| 404    | `{ "error": "not_found" }`                 |
| 409    | `{ "error": "plan_already_exists" }`       |
| 409    | `{ "error": "paddlePriceId_already_exists" }` |

### `DELETE /api/products/[id]/tiers/[tid]`

Delete a tier. Refuses with 409 if any `License` row still references
it — revoke those licenses or reassign them to another tier first.

**Path params**: `id` (Product id), `tid` (PriceTier id)

**Responses**
| Status | Body                                  | Notes                                |
|--------|---------------------------------------|--------------------------------------|
| 200    | `{ "ok": true }`                      |                                      |
| 401    | `{ "error": "unauthorized" }`         |                                      |
| 404    | `{ "error": "not_found" }`            |                                      |
| 409    | `{ "error": "tier_has_licenses" }`    | At least one `License.tierId` points here |

---

## Licenses

### `POST /api/licenses`

Manually create a License (admin-only, bypasses Paddle). Intended for
offline / gift / support cases with no Paddle transaction. The raw
License Key is returned **once** in the response so the UI can show it —
it is never persisted, so the caller must capture it immediately.

The License stores the customer `email` but has **no Order**: Paddle
refund webhooks will not touch it — revoke manually if needed. Plan /
expiry are snapshotted from the product's first price tier (same
heuristic as the Paddle webhook).

**Request body**
```json
{
  "productId": "<Product id>",
  "email": "customer@example.com"
}
```

**Responses**
| Status | Body                                                                  |
|--------|-----------------------------------------------------------------------|
| 200    | `{ "ok": true, "licenseId": "<License id>", "rawKey": "ABCD-…" }`   |
| 400    | `{ "error": "invalid_json" \| "invalid_payload", … }`                |
| 400    | `{ "error": "product_has_no_signing_key" }`                          |
| 401    | `{ "error": "unauthorized" }`                                        |
| 404    | `{ "error": "product_not_found" }`                                   |

### `POST /api/licenses/[id]/resend-email`

Re-send the license email to the customer. Because the raw key is never
stored, this **rotates the License Key in place**: the same License row
keeps its `id` (License Identity), device activations and migration
fields — only `keyHash` is replaced with a fresh credential, which is
then emailed. The old key stops matching the stored hash immediately.
The rotation is recorded in the audit trail (`license.key_rotated`).

**Path params**: `id` (License id)

**Template selection**: `Order.locale` (captured at Paddle checkout) →
matched against `ProductEmailTemplate.locale` by `-`-prefix; falls back
to the product's `isDefault` template (always `en`).

**Request body**: none.

**Responses**
| Status | Body                                              | Notes                                            |
|--------|---------------------------------------------------|--------------------------------------------------|
| 200    | `{ "ok": true, "licenseId": "<same license id>" }` | Identity unchanged; key rotated + emailed        |
| 400    | `{ "error": "invalid_params" }`                   |                                                  |
| 400    | `{ "error": "product_has_no_signing_key" }`       | Generate a signing key for the product first     |
| 400    | `{ "error": "no_customer_email_on_order" }`       | Order has no Paddle email — re-send manually      |
| 401    | `{ "error": "unauthorized" }`                     |                                                  |
| 404    | `{ "error": "not_found" }`                        |                                                  |
| 500    | `{ "error": "<resend message>" }`                 | Email send failed; the new key was already rotated in |

### `POST /api/licenses/[id]/revoke`

Mark a license as revoked. Activations are kept on disk for audit but
the key will fail `validate` / `activate` / `check-in` calls afterwards.
The transition is recorded in the audit trail
(`license.status_changed`).

**Path params**: `id` (License id)

**Request body** (optional)
```json
{ "reason": "chargeback" }
```

**Responses**
| Status | Body                                              |
|--------|---------------------------------------------------|
| 200    | `{ "ok": true, "license": License }`           |
| 400    | `{ "error": "invalid_params" \| "invalid_body", … }` |
| 401    | `{ "error": "unauthorized" }`                     |
| 404    | `{ "error": "not_found" }`                        |

---

## Migration

### `POST /api/v1/migration/export`

Create a **signed bulk migration export** (spec §13 Part A / §21): one
Ed25519-signed document containing the selected License state
(`license_id`, `product_id`, `plan`, `status`, `max_devices`,
`expires_at`, `created_at`). The destination License system verifies the
document with Licentra's public key and imports it — no Licentra API
needs to stay online afterwards.

**Security** (spec §22): admin session required, per-IP rate limiting
(10/min), audit trail (`license.migration_exported` — one row per export;
the signed document is the per-license record). Never includes
plaintext License Keys or private signing keys.

**Request body** (all optional)
```json
{
  "productId": "<Product id — omit to export all products>",
  "licenseIds": ["<License id>", "…"],
  "destinationSystem": "new-license-system",
  "includeCustomerData": false,
  "migrationId": "migration_2026_08_14"
}
```

| Field               | Type     | Notes                                                  |
|---------------------|----------|--------------------------------------------------------|
| productId           | string?  | Filter by product                                      |
| licenseIds          | array?   | Filter by specific licenses (max 10000)                |
| destinationSystem   | string?  | Recorded in the signed doc + audit                     |
| includeCustomerData | boolean? | Adds `email`/`customer_id` per license (§13 "if needed") |
| migrationId         | string?  | Auto-generated when omitted; used for duplicate-import prevention |

**Responses**
| Status | Body                                                                 |
|--------|----------------------------------------------------------------------|
| 200    | `{ "type": "licentra_license_migration_export", …, "signature": "…" }` |
| 400    | `{ "error": "invalid_payload", "details": {…} }`                    |
| 401    | `{ "error": "unauthorized" }`                                       |
| 404    | `{ "error": "no_licenses" }`                                        |
| 429    | `{ "error": "rate_limited", "retryAfterSeconds": n }`               |

Verification of the exported document is documented in
`docs/licentra-offline-migration-spec.md` §28. Public keys are served at
`GET /api/v1/well-known/licentra-keys`.
