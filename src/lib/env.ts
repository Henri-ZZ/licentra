import { z } from "zod";

/**
 * Environment variable schema.
 *
 * All vars must be present at startup. Defaults are provided for local
 * development so the app can boot without a full secrets file; in production
 * the values MUST be overridden via real env vars.
 */
const envSchema = z.object({
  // --- Database ---
  DATABASE_URL: z
    .string()
    .min(1)
    .default(
      "postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/licentra?sslmode=require"
    ),

  // --- Auth (single user, hardcoded for now) ---
  ADMIN_EMAIL: z
    .string()
    .email()
    .default("henriz@henri.ren"),
  ADMIN_PASSWORD: z.string().min(1).default("Gun748.."),
  AUTH_JWT_SECRET: z
    .string()
    .min(32, "AUTH_JWT_SECRET must be >= 32 chars")
    .default("dev-jwt-secret-please-change-this-to-a-real-32-byte-value"),

  // --- License signing ---
  LICENSE_MASTER_KEY: z
    .string()
    .min(64, "LICENSE_MASTER_KEY must be 32-byte hex (64 chars)")
    .default("0".repeat(64)),

  // --- Paddle ---
  PADDLE_WEBHOOK_SECRET: z
    .string()
    .min(1)
    .default("pdl_ntfk_dev_secret_replace_me"),
  PADDLE_API_KEY: z
    .string()
    .min(1)
    .default("pdl_sdbx_replace_me"),

  // --- Resend ---
  RESEND_API_KEY: z.string().min(1).default("re_dev_replace_me"),

  // --- Email template vars ---
  // {{supportEmail}} placeholder in default email templates. Falls back
  // to the no-reply Resend dev address so dev/stub mode still renders.
  SUPPORT_EMAIL: z
    .string()
    .email()
    .default("onboarding@resend.dev"),

  // --- App ---
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url()
    .default("http://localhost:3000"),

  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "❌ Invalid environment variables:",
    JSON.stringify(parsed.error.flatten().fieldErrors, null, 2)
  );
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;