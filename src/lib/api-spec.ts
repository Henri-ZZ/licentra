/**
 * OpenAPI 3.1 spec for the external (product-facing) API.
 *
 * Served as JSON at GET /api-docs/spec.json so integrators can import it
 * into Postman / Insomnia / openapi-generator. Rendered visually by the
 * dashboard's API docs page via Swagger UI.
 *
 * The shape intentionally mirrors src/lib/license-sign.ts (LicensePayload /
 * LicenseResponse) and the runtime route handlers so docs don't drift.
 *
 * Authoring hand-rolled (no `openapi-types` dep) — the spec is small enough
 * that pulling a type library is overkill.
 */

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Licentra External API",
    version: "1.0.0",
    description:
      "Endpoints for product license activation / validation and the Paddle webhook. " +
      "Used by the customer's end-user software and by Paddle.",
  },
  servers: [{ url: "/", description: "Current host" }],
  tags: [
    { name: "License", description: "Mutated by the customer's product client" },
    { name: "Webhook", description: "Called by Paddle" },
    { name: "Migration", description: "Public-key discovery for migration partners" },
  ],
  paths: {
    "/api/license/activate": {
      post: {
        tags: ["License"],
        summary: "Bind a fingerprint to a license",
        description:
          "Idempotent. If the same fingerprint is already bound, lastCheckedAt is refreshed. " +
          "If the license is at its maxActivations cap, the oldest activation is evicted silently " +
          "and the new fingerprint is bound.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ActivateRequest" },
              example: {
                key: "ABCD-1234-EFGH-5678",
                fingerprint: "mac-abc123def",
                label: "Alice's MacBook",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Signed payload or invalid state",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/LicenseSignedResponse" },
                    { $ref: "#/components/schemas/LicenseInvalidResponse" },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
        },
      },
    },

    "/api/license/check-in": {
      post: {
        tags: ["License"],
        summary: "Heartbeat from running product",
        description:
          "Confirms the fingerprint is still bound. The client re-checks when " +
          "`payload.valid_until` has passed. If the fingerprint was evicted " +
          "(e.g. another machine displaced it), returns `activation_evicted` so " +
          "the client can prompt re-activation.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CheckInRequest" },
              example: {
                key: "ABCD-1234-EFGH-5678",
                fingerprint: "mac-abc123def",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Signed payload or invalid state",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/LicenseSignedResponse" },
                    { $ref: "#/components/schemas/LicenseInvalidResponse" },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
        },
      },
    },

    "/api/v1/well-known/licentra-keys": {
      get: {
        tags: ["Migration"],
        summary: "Licentra Ed25519 public keys (certificate verification)",
        description:
          "Public-key discovery for Signed License Certificates and migration " +
          "exports (docs/licentra-offline-migration-spec.md §9). Destination " +
          "License systems and offline clients fetch the Ed25519 public key " +
          "matching a certificate's `kid` here to verify it WITHOUT calling " +
          "the Licentra API. Retired keys stay listed so certificates issued " +
          "under an old kid remain verifiable after rotation. " +
          "Public and read-only — no auth, no rate limiting.",
        responses: {
          "200": {
            description: "The current + legacy public key set.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PublicKeySet" },
              },
            },
          },
        },
      },
    },

    "/api/webhook/paddle-transaction-completed": {
      post: {
        tags: ["Webhook"],
        summary: "Paddle — transaction.completed",
        description:
          "Receives the Paddle Billing `transaction.completed` event. " +
          "Authenticated via the `Paddle-Signature` header: " +
          "`ts=<unix-seconds>;h1=<hex>`. HMAC-SHA256 is computed over " +
          "`\"${ts}.${rawBody}\"` using `PADDLE_WEBHOOK_SECRET`. Timestamps " +
          "further than 5 minutes from server time are rejected. " +
          "Idempotent: every event is keyed by `event_id` in the WebhookEvent " +
          "table; re-deliveries return `{ ok: true, duplicate: true }` " +
          "without re-processing. " +
          "On a fresh event, creates an Order + License for the customer " +
          "and sends the license email. " +
          "Product resolution: `custom_data.productId` (Licentra Product.cuid) " +
          "preferred, falls back to Paddle's literal `product_id` matching " +
          "`Product.paddleProductId`. " +
          "Email template selection: `data.customer.locale` prefix-matched " +
          "against `ProductEmailTemplate.locale`; falls back to the product's " +
          "isDefault template (always `en`). " +
          "Reject with 400 `wrong_event_type` if any other event_type is " +
          "delivered to this URL — configure Paddle to send each event type " +
          "to its dedicated URL (`paddle-transaction-updated` for " +
          "`transaction.updated`).",
        parameters: [
          {
            name: "Paddle-Signature",
            in: "header",
            required: true,
            schema: { type: "string", example: "ts=1736937600;h1=abc123..." },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PaddleTransactionCompleted" },
              example: {
                event_id: "evt_01hxxxxxxxxxxxxxxxxxxxxxx",
                event_type: "transaction.completed",
                occurred_at: "2026-01-15T10:30:00.000Z",
                data: {
                  id: "txn_01hxxxxxxxxxxxxxxxxxxxxxx",
                  status: "completed",
                  customer_id: "ctm_01hxxxxxxxxxxxxxxxxxxxxxx",
                  custom_data: {
                    productId: "<Licentra Product.cuid>",
                    paddleProductId: "pro_xxx",
                  },
                  items: [{ price_id: "pri_xxx", quantity: 1 }],
                  customer: {
                    id: "ctm_01hxxxxxxxxxxxxxxxxxxxxxx",
                    email: "buyer@example.com",
                    name: "Buyer Name",
                    locale: "zh-CN",
                  },
                  details: {
                    totals: { grand_total: "2999", currency_code: "USD" },
                    customer: {
                      email: "buyer@example.com",
                      locale: "zh-CN",
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Processed (or duplicate).",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", enum: [true] },
                    duplicate: { type: "boolean" },
                  },
                  required: ["ok"],
                },
              },
            },
          },
          "400": {
            description:
              "Invalid JSON, wrong event_type, or expired signature window.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "401": {
            description: "Bad/missing/expired Paddle-Signature.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "500": {
            description: "Handler threw — Paddle will retry.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },

    "/api/webhook/paddle-transaction-updated": {
      post: {
        tags: ["Webhook"],
        summary: "Paddle — transaction.updated",
        description:
          "Receives the Paddle Billing `transaction.updated` event. " +
          "Authentication, idempotency, and the WebhookEvent table work the " +
          "same as `paddle-transaction-completed`. " +
          "Currently the handler reacts only when the transaction status " +
          "transitions to a refunded / canceled / partially_refunded state: " +
          "the associated Order's status is synced and any License rows " +
          "tied to that order are revoked. Other status transitions are " +
          "recorded but ignored. " +
          "Reject with 400 `wrong_event_type` if any other event_type is " +
          "delivered to this URL.",
        parameters: [
          {
            name: "Paddle-Signature",
            in: "header",
            required: true,
            schema: { type: "string", example: "ts=1736937600;h1=abc123..." },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PaddleTransactionUpdated" },
              example: {
                event_id: "evt_01hyyyyyyyyyyyyyyyyyyyy",
                event_type: "transaction.updated",
                occurred_at: "2026-01-15T10:31:00.000Z",
                data: {
                  id: "txn_01hxxxxxxxxxxxxxxxxxxxxxx",
                  status: "refunded",
                  customer_id: "ctm_01hxxxxxxxxxxxxxxxxxxxxxx",
                  custom_data: {
                    productId: "<Licentra Product.cuid>",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Processed (or duplicate).",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", enum: [true] },
                    duplicate: { type: "boolean" },
                  },
                  required: ["ok"],
                },
              },
            },
          },
          "400": {
            description:
              "Invalid JSON, wrong event_type, or expired signature window.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "401": {
            description: "Bad/missing/expired Paddle-Signature.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "500": {
            description: "Handler threw — Paddle will retry.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    responses: {
      BadRequest: {
        description: "Malformed request body or invalid fields.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string", description: "Machine-readable error code" },
          details: {
            type: "object",
            additionalProperties: true,
            description: "Optional field-level details (e.g. zod flatten output).",
          },
        },
      },

      ActivateRequest: {
        type: "object",
        required: ["key", "fingerprint"],
        properties: {
          key: { type: "string", minLength: 1 },
          fingerprint: { type: "string", minLength: 1, description: "Stable per-machine identifier" },
          label: { type: "string", maxLength: 120, description: "Human-readable device name" },
        },
      },
      CheckInRequest: {
        type: "object",
        required: ["key", "fingerprint"],
        properties: {
          key: { type: "string", minLength: 1 },
          fingerprint: { type: "string", minLength: 1 },
        },
      },
      LicensePayload: {
        type: "object",
        required: ["product", "plan", "license_id", "license_expires_at", "valid_until"],
        properties: {
          product: { type: "string", description: "Product slug" },
          plan: { type: "string", description: "Plan name (e.g. 'standard', 'lifetime')" },
          license_id: { type: "string", description: "License cuid" },
          license_expires_at: {
            type: ["string", "null"],
            format: "date-time",
            description:
              "When the license entitlement expires (null = lifetime). " +
              "Business-level subscription expiry — NOT the signature window.",
          },
          valid_until: {
            type: "string",
            format: "date-time",
            description:
              "Signature expiry (ISO). = issue time + product.signatureTtlSeconds. " +
              "The client must re-verify online once now >= valid_until.",
          },
        },
      },

      LicenseSignedResponse: {
        type: "object",
        required: ["valid", "payload", "signature"],
        properties: {
          valid: { type: "boolean", enum: [true] },
          payload: { $ref: "#/components/schemas/LicensePayload" },
          signature: {
            type: "string",
            description:
              "Base64-encoded ECDSA-DER signature over JSON.stringify(payload). " +
              "Verify using the product's public key (ECDSA P-256 / SHA-256).",
          },
          certificate: {
            $ref: "#/components/schemas/LicenseCertificate",
            description:
              "Signed License Certificate (Ed25519, Licentra-level) issued on " +
              "every successful verification. The client stores it locally so it " +
              "can migrate offline later without contacting Licentra.",
          },
        },
      },

      LicenseCertificate: {
        type: "object",
        required: [
          "type",
          "version",
          "issuer",
          "kid",
          "license_id",
          "product_id",
          "plan",
          "status",
          "max_devices",
          "issued_at",
          "expires_at",
          "nonce",
          "signature",
        ],
        properties: {
          type: { type: "string", enum: ["licentra_license_certificate"] },
          version: { type: "integer", enum: [1] },
          issuer: { type: "string", enum: ["licentra"] },
          kid: { type: "string", description: "Signing key id, e.g. 'licentra-2026-08'" },
          license_id: { type: "string", description: "Permanent License Identity" },
          product_id: { type: "string", description: "Product slug the certificate is bound to" },
          plan: { type: "string" },
          status: { type: "string", enum: ["active", "expired", "revoked", "suspended"] },
          max_devices: { type: "integer" },
          issued_at: { type: "integer", description: "Unix seconds" },
          expires_at: { type: ["string", "null"], description: "License expiry (null = lifetime)" },
          nonce: { type: "string", description: "Replay-protection nonce" },
          signature: {
            type: "string",
            description:
              "Base64 Ed25519 signature over the canonical JSON of all other " +
              "fields (fixed field order). Verify with the public key for `kid` " +
              "from GET /api/v1/well-known/licentra-keys.",
          },
        },
      },

      PublicKeySet: {
        type: "object",
        required: ["keys"],
        properties: {
          keys: {
            type: "array",
            items: {
              type: "object",
              required: ["kid", "algorithm", "public_key", "active"],
              properties: {
                kid: { type: "string" },
                algorithm: { type: "string", enum: ["Ed25519"] },
                public_key: { type: "string", description: "PEM-encoded public key" },
                active: { type: "boolean" },
              },
            },
          },
        },
      },

      LicenseInvalidResponse: {
        type: "object",
        required: ["valid", "reason"],
        properties: {
          valid: { type: "boolean", enum: [false] },
          reason: {
            type: "string",
            enum: [
              "license_not_found",
              "license_revoked",
              "license_refunded",
              "activation_evicted",
            ],
            description:
              "license_not_found: key is unknown. license_revoked: admin revoked, or no signing key. " +
              "license_refunded: Paddle issued a refund. activation_evicted: this fingerprint is no longer bound.",
          },
        },
      },

      PaddleTransactionCompleted: {
        type: "object",
        required: ["event_id", "event_type", "occurred_at", "data"],
        properties: {
          event_id: { type: "string" },
          event_type: { type: "string", enum: ["transaction.completed"] },
          occurred_at: { type: "string", format: "date-time" },
          data: {
            type: "object",
            required: ["id", "status"],
            properties: {
              id: { type: "string", description: "Paddle transaction id" },
              status: { type: "string" },
              customer_id: { type: ["string", "null"] },
              custom_data: {
                type: ["object", "null"],
                properties: {
                  productId: {
                    type: "string",
                    description: "Licentra Product.cuid (preferred resolution path)",
                  },
                  paddleProductId: {
                    type: "string",
                    description: "Fallback — matched against Product.paddleProductId",
                  },
                },
              },
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    price_id: { type: "string" },
                    quantity: { type: "integer" },
                  },
                },
              },
              customer: {
                type: ["object", "null"],
                properties: {
                  id: { type: "string" },
                  email: { type: "string", format: "email" },
                  name: { type: ["string", "null"] },
                  locale: {
                    type: "string",
                    description: "BCP-47 like 'zh-CN' — used to pick ProductEmailTemplate",
                  },
                },
              },
              details: {
                type: "object",
                properties: {
                  totals: {
                    type: "object",
                    properties: {
                      grand_total: { type: "string" },
                      currency_code: { type: "string" },
                    },
                  },
                  customer: {
                    type: "object",
                    properties: {
                      email: { type: "string", format: "email" },
                      locale: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      PaddleTransactionUpdated: {
        type: "object",
        required: ["event_id", "event_type", "occurred_at", "data"],
        properties: {
          event_id: { type: "string" },
          event_type: { type: "string", enum: ["transaction.updated"] },
          occurred_at: { type: "string", format: "date-time" },
          data: {
            type: "object",
            required: ["id", "status"],
            properties: {
              id: { type: "string", description: "Paddle transaction id" },
              status: {
                type: "string",
                description:
                  "Subscription-relevant statuses include 'refunded', 'partially_refunded', 'canceled', 'cancelled', 'past_due'.",
              },
              customer_id: { type: ["string", "null"] },
              custom_data: {
                type: ["object", "null"],
                properties: {
                  productId: {
                    type: "string",
                    description: "Licentra Product.cuid — used to look up the order",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export type OpenApiSpec = typeof openApiSpec;
