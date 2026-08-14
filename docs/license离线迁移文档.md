# Licentra Offline-Capable License Migration Specification

> **Purpose:** Define a License architecture that allows Licentra licenses to be migrated to another License system **without requiring the old Licentra API to remain online** and without requiring existing users to re-activate.
>
> This document is a protocol specification for:
> - the Licentra development agent;
> - future migration agents/developers operating the destination License system.
>
> **Core principle:** A License Key is a credential. A License ID is the License identity. A signed License Certificate is portable cryptographic proof of the License.

---

# 1. Problem this design solves

A naive migration strategy is:

```text
Old client
   ↓
Old Licentra API
   ↓
verify old License Key
   ↓
New License system
```

This creates a hard dependency on the old API.

It has a major problem:

> If Licentra is shut down, users who have not returned to the application cannot be migrated through the old API.

Therefore, **migration must not depend on a live Licentra API.**

The system must instead prepare portable proof while Licentra is still operating.

---

# 2. Required architecture

Licentra separates three concepts:

```text
License Identity
    ↓
Stable identity of the License

License Key
    ↓
User credential

Signed License Certificate
    ↓
Portable cryptographic proof of License ownership/state
```

Example:

```text
License ID:
lic_01JXYZ123

License Key:
SBA-ABCD-EFGH-IJKL

Certificate:
signed data proving that lic_01JXYZ123
is a valid SBA License with specific state
```

The License Key must NOT be treated as the permanent identity of the License.

---

# 3. License Identity

Every License receives a stable unique identifier:

```text
lic_01JXYZ123456789
```

This ID must remain unchanged for the entire lifetime of the License.

It must not change when:

- the License Key is rotated;
- the user changes devices;
- the License is migrated;
- the hashing implementation changes;
- the License is moved to another backend.

The destination system should preserve this ID as the source identity:

```text
source_system = "licentra"
source_license_id = "lic_01JXYZ123"
```

The destination system may create its own internal ID:

```text
destination_license_id = "new_abc123"
```

The mapping is:

```text
Licentra:
lic_01JXYZ123
        ↓
Destination:
new_abc123
```

---

# 4. License Key

The License Key is a credential presented by the user/client.

Example:

```text
SBA-ABCD-EFGH-IJKL
```

Licentra should store only a secure hash:

```text
license_key_hash
```

Do NOT store the plaintext License Key.

Do NOT design migration around converting:

```text
old_hash → new_hash
```

That is impossible in the general case.

Different systems may use different:

- hash algorithms;
- salts;
- KDF parameters.

Migration must therefore use the signed License Certificate, not the License Key hash.

---

# 5. Signed License Certificate

This is the central feature of the migration architecture.

After a License Key is successfully validated, Licentra creates a signed License Certificate.

Conceptually:

```text
License Key
     ↓
Licentra API
     ↓
validate
     ↓
License record
     ↓
create certificate payload
     ↓
Ed25519 signature
     ↓
Signed License Certificate
```

The client stores the certificate locally.

The certificate can later be verified without contacting Licentra.

---

# 6. Certificate contents

The certificate should contain enough information to establish the License's identity and relevant authorization state.

Example payload:

```json
{
  "type": "licentra_license_certificate",
  "version": 1,
  "issuer": "licentra",
  "kid": "licentra-2026-01",
  "license_id": "lic_01JXYZ123456789",
  "product_id": "sba",
  "plan": "lifetime",
  "status": "active",
  "max_devices": 2,
  "issued_at": 1786700000,
  "expires_at": null
}
```

A signature is then generated over the canonical serialized payload.

Conceptually:

```text
certificate_payload
       ↓
canonical serialization
       ↓
Ed25519 private key
       ↓
signature
```

The final certificate may be represented as a compact signed token or another versioned format.

The exact encoding can be chosen during implementation, but it must be deterministic and documented.

---

# 7. What the certificate proves

A valid certificate proves:

> Licentra signed this License Identity and these License properties.

For example:

```text
license_id = lic_01JXYZ123
product_id = sba
plan = lifetime
status = active
max_devices = 2
```

The certificate does NOT prove:

- the identity of the human user;
- payment information;
- the user's email unless explicitly included;
- that the License can never be revoked;
- anything not included in the signed payload.

Only signed fields should be trusted by a destination system.

---

# 8. Public/private key architecture

Licentra maintains an Ed25519 signing key pair.

```text
Licentra
├── private signing key
└── public verification key
```

The private key:

- must remain secret;
- must never be shipped to clients;
- must never be returned by an API;
- must never appear in logs.

The public key:

- can be distributed to clients;
- can be distributed to migration partners;
- can be embedded in clients where appropriate;
- can be published through a key discovery endpoint.

---

# 9. Key ID and key rotation

Every certificate must contain:

```text
kid
```

Example:

```text
kid = licentra-2026-01
```

Licentra should expose a public key discovery mechanism.

Conceptually:

```http
GET /.well-known/licentra-keys
```

Example response:

```json
{
  "keys": [
    {
      "kid": "licentra-2026-01",
      "algorithm": "Ed25519",
      "public_key": "..."
    }
  ]
}
```

When rotating signing keys:

```text
old key:
licentra-2026-01

new key:
licentra-2027-01
```

New certificates use the new key.

Old public keys must remain available for as long as old certificates may need to be verified.

The migration specification must support multiple active/legacy public keys.

---

# 10. Normal License activation

Normal activation should work like this:

```text
Client
  │
  │ License Key
  ▼
Licentra API
  │
  │ hash/verify
  ▼
Licentra Database
  │
  │ valid
  ▼
Licentra API
  │
  ├── License verification result
  │
  └── Signed License Certificate
          │
          ▼
        Client
```

The client stores:

```text
License Key
Signed License Certificate
```

The License Key may continue to be used for online verification.

The certificate exists as a portable proof and offline verification artifact.

---

# 11. Local certificate verification

The client can verify the certificate without Licentra:

```text
Signed License Certificate
        ↓
read kid
        ↓
obtain matching public key
        ↓
verify Ed25519 signature
        ↓
valid
```

The client must also validate semantic fields:

```text
product_id == current product
status is acceptable
expires_at is not exceeded
certificate version is supported
```

Signature validity alone is not enough.

---

# 12. Important distinction: certificate vs live status

A signed certificate is a snapshot.

For example:

```text
2026-08-01
status = active
```

If Licentra later revokes the License:

```text
2026-08-10
status = revoked
```

an old certificate may still cryptographically verify as a genuine Licentra certificate.

Therefore, products that require real-time revocation must still perform online verification when connected.

Migration use cases are different:

> The destination system is allowed to use the certificate as proof of the License state represented by the certificate, according to the migration policy.

Do not falsely represent a historical certificate as real-time revocation status.

---

# 13. Migration OUT of Licentra

The migration process has two independent parts.

## Part A: migrate the License database

Licentra exports License state:

```text
license_id
product_id
customer_id
email (if needed)
plan
status
max_devices
expires_at
created_at
```

This export can be signed by Licentra.

The destination imports it:

```text
Licentra
   ↓
signed export
   ↓
Destination License System
   ↓
verify with Licentra public key
   ↓
create destination licenses
```

This does NOT require any user to be online.

It does NOT require the old API to remain available after the export.

---

## Part B: migrate existing client installations

Existing clients already contain:

```text
License Key
Signed License Certificate
```

Therefore they can migrate without calling Licentra.

Example:

```text
Old client
   │
   │ Signed License Certificate
   ▼
Destination License System
   │
   │ verify using Licentra public key
   ▼
valid
   │
   ▼
create destination License
   │
   ▼
return destination credential
   │
   ▼
client stores new credential
```

No Licentra API request is required.

---

# 14. Migration flow in detail

Assume:

```text
Old License:
lic_001

Old certificate:
CERT-OLD-001

Destination License:
new_001
```

The client has:

```text
License Key = SBA-OLD-XXXX
Certificate = CERT-OLD-001
```

After a new product version is installed:

```text
1. Client detects a Licentra certificate.
2. Client sends the certificate to the destination system.
3. Destination verifies the Ed25519 signature.
4. Destination verifies `product_id`.
5. Destination verifies certificate version.
6. Destination checks certificate expiration/state according to migration policy.
7. Destination maps `lic_001` to a destination License.
8. Destination returns its new credential.
9. Client stores the new credential.
10. Client stops depending on Licentra.
```

No old API call is needed.

---

# 15. Migration database mapping

The destination system should preserve source identity.

Example:

```text
destination_licenses
├── id
├── source_system
├── source_license_id
├── product_id
├── plan
├── status
├── max_devices
└── expires_at
```

Example:

```text
id = new_001
source_system = licentra
source_license_id = lic_001
product_id = sba
plan = lifetime
status = active
```

This prevents duplicate migration.

A unique constraint should normally exist on:

```text
(source_system, source_license_id)
```

unless there is a documented reason not to.

---

# 16. Migration of users who are offline or uninstalled

This design intentionally does NOT require every user to come online.

Suppose Licentra has:

```text
1000 active licenses
```

and only:

```text
700 users
```

return after migration.

The database migration still imports all 1000 licenses:

```text
1000 Licenses
     ↓
1000 destination Licenses
```

The 700 active clients can automatically transition using their certificates.

The 300 users who never return do not matter.

They already have a corresponding License in the destination database.

If they later reinstall the product, the product can use the destination system's recovery/account/order process, depending on product design.

---

# 17. When can Licentra shut down?

With this architecture, there is no need to wait until every user has contacted the old API.

The shutdown process can be:

```text
1. Freeze Licentra License creation.
2. Export all License records.
3. Sign the export.
4. Import all Licenses into destination.
5. Publish destination client version.
6. Keep old public keys available to migration tooling.
7. Allow a transition period.
8. Stop Licentra API.
```

The destination system and clients can continue using:

```text
License Identity
+
Signed License Certificate
```

The old API is not required for migration.

---

# 18. What if the user has no certificate?

This is an important fallback case.

If an old client version stored only:

```text
License Key
```

and did not store a Signed License Certificate, then fully offline migration may not be possible for that client.

Possible fallback:

```text
old License Key
      ↓
old Licentra API
      ↓
verify
      ↓
migration
```

Therefore:

> The offline migration guarantee applies to clients that have received and stored a valid Signed License Certificate.

This is why certificate issuance must be part of Licentra's normal License verification flow from v1.

---

# 19. Certificate refresh

A client should periodically obtain a fresh certificate while Licentra is online.

Example:

```text
License verification
      ↓
certificate valid
      ↓
certificate refreshed
```

This provides a more recent signed snapshot.

The exact refresh interval is product-dependent.

For example:

```text
30 days
90 days
on License status change
```

Do not hard-code an interval in the migration protocol unless required.

---

# 20. Revocation considerations

A certificate cannot magically reflect future revocation.

If a License is revoked after certificate issuance:

```text
Old certificate:
status = active
```

may still verify cryptographically.

Therefore:

- online products should periodically verify against Licentra while it exists;
- migration tooling must define how `status` is interpreted;
- the final signed migration export should represent the authoritative License state at migration time.

For a migration, the preferred source of truth is:

```text
signed database export
```

or an equivalent signed server-side export created immediately before cutover.

---

# 21. Signed bulk migration export

For large migrations, do not create millions of individual API calls.

Licentra should support a bulk export concept.

Example:

```json
{
  "type": "licentra_license_migration_export",
  "version": 1,
  "issuer": "licentra",
  "export_id": "migration_2026_08_01",
  "created_at": 1786700000,
  "licenses": [
    {
      "license_id": "lic_001",
      "product_id": "sba",
      "plan": "lifetime",
      "status": "active",
      "max_devices": 2,
      "expires_at": null
    }
  ],
  "kid": "licentra-2026-01",
  "signature": "..."
}
```

For very large datasets, a canonical file format and streaming/batch processing may be used.

The entire export or each signed record must have an unambiguous integrity mechanism.

---

# 22. Migration security

Migration must require explicit authorization.

Do not expose unrestricted endpoints that allow anyone to generate migration certificates for arbitrary licenses.

Require:

- administrator authentication;
- appropriate authorization;
- audit logging;
- rate limiting;
- CSRF protection where applicable;
- careful handling of customer data;
- protection against duplicate imports.

Never log:

- plaintext License Keys;
- private signing keys;
- full authentication secrets.

---

# 23. Migration replay protection

Certificates used for migration should contain:

```text
license_id
issuer
issued_at
kid
nonce or unique certificate ID
```

For destination imports, track:

```text
source_system
source_license_id
migration_id
```

This prevents accidental duplicate creation.

If certificates are intentionally long-lived for offline migration, the destination should rely on the certificate's License Identity and migration mapping rather than treating the same certificate as a new License every time.

---

# 24. Product binding

A certificate must be bound to a specific product:

```text
product_id = sba
```

A certificate issued for:

```text
product_id = edit-page
```

must not be accepted as proof of an SBA License.

The destination must validate:

```text
certificate.product_id
==
destination_product_id
```

---

# 25. License plan and entitlement binding

The certificate should include the entitlements necessary for migration.

For example:

```text
plan
max_devices
expires_at
status
```

Do not let the destination system upgrade entitlements merely because a certificate was valid.

Example:

```text
lifetime
```

must remain lifetime.

```text
max_devices = 2
```

must not silently become:

```text
max_devices = 100
```

unless there is an explicit migration rule.

---

# 26. Migration audit trail

Licentra should record:

```text
license.migration_certificate_issued
license.migration_exported
license.key_rotated
license.status_changed
```

Useful fields:

```text
license_id
migration_id
actor
timestamp
destination_system
```

The destination system should record:

```text
license.imported
license.migrated
source_system
source_license_id
migration_id
timestamp
```

---

# 27. Agent implementation requirements

When implementing Licentra:

1. Create a stable `license_id`.
2. Keep License Identity separate from License Key.
3. Store only a secure License Key hash.
4. Generate a Signed License Certificate after successful License verification.
5. Store the certificate on the client.
6. Use Ed25519 signatures.
7. Include `kid`.
8. Implement public-key discovery.
9. Support signing-key rotation.
10. Never expose the private signing key.
11. Bind certificates to `product_id`.
12. Include License state required for migration.
13. Provide a secure mechanism for bulk License export.
14. Make exports verifiable without the old API.
15. Record source License IDs during migration.
16. Make migration operations auditable.
17. Do not make migration dependent on the original License Key.
18. Do not make migration dependent on the old API being online.
19. Do not assume that every user will return before shutdown.
20. Keep certificate verification logic deterministic and versioned.

---

# 28. Destination-agent migration procedure

A future migration agent should follow this procedure.

### Step 1 — Obtain Licentra public keys

Retrieve the official Licentra public key set and verify its authenticity through a trusted channel.

### Step 2 — Obtain the signed migration export

Receive the signed License export from Licentra.

### Step 3 — Verify the export

Verify:

```text
issuer
signature
kid
export version
integrity
```

Do not import unverified data.

### Step 4 — Create destination License records

For every Licentra License:

```text
source_system = licentra
source_license_id = Licentra license_id
```

Preserve:

```text
product_id
plan
status
max_devices
expires_at
```

according to the migration agreement.

### Step 5 — Prevent duplicates

Use:

```text
(source_system, source_license_id)
```

as the migration identity.

### Step 6 — Support client migration

The new client should accept a Licentra Signed License Certificate.

Verify it using the Licentra public key.

If valid:

```text
source_license_id
        ↓
destination_license_id
```

Then issue/store the destination credential.

### Step 7 — Stop depending on Licentra

Once the migration is complete, the destination system must not call the Licentra API as part of normal verification.

---

# 29. The complete architecture

Normal operation:

```text
             ┌──────────────────┐
             │     Licentra     │
             │                  │
             │ DB + API         │
             │ Private Key      │
             └────────┬─────────┘
                      │
                signed certificate
                      │
                      ▼
             ┌──────────────────┐
             │      Client      │
             │                  │
             │ License Key      │
             │ Certificate      │
             └──────────────────┘
```

Future migration:

```text
                  Licentra
                     │
          ┌──────────┴──────────┐
          │                     │
   Signed bulk export    Public key set
          │                     │
          └──────────┬──────────┘
                     ▼
            Destination System
                     │
             verify signatures
                     │
                     ▼
             Create new Licenses
                     │
                     ▼
                  Clients
                     │
             verify certificate
                     │
                     ▼
             obtain new credential
```

After cutover:

```text
Licentra API
     OFFLINE
       X

Destination System
     ONLINE
       │
       ▼
   Clients
```

No old API verification is required.

---

# 30. Final design rule

The architecture must guarantee this:

> **A valid License can carry its own portable cryptographic proof.**

Therefore:

```text
License Key
    ≠
License Identity
    ≠
Signed License Certificate
```

The roles are:

```text
License Key
    → proves possession during normal activation

License ID
    → identifies the License permanently

Signed Certificate
    → proves to another system what Licentra authorized
```

This is the mechanism that allows Licentra to be shut down without making future migration dependent on the old API.

