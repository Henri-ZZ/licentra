import { Resend } from "resend";

import { env } from "@/lib/env";

/**
 * Resend email client + simple placeholder-rendering for product-specific
 * license-key delivery emails.
 *
 * Templates are stored on `ProductEmailTemplate` rows and use a mix of
 * placeholders:
 *   {{xxx}} — interpolated at send time (this file)
 *   [[xxx]] — literal hints the admin edits out before saving (left alone)
 *
 * Supported interpolation vars (see `LicenseEmailVars` below).
 */

const resend = new Resend(env.RESEND_API_KEY);

export interface LicenseEmailVars {
  /** License key string (the customer's actual key). */
  code: string;
  /** Product display name. */
  productName: string;
  /** Plan name (e.g. "standard", "lifetime"). */
  plan: string;
  /** Paddle transaction id (txn_...), shown as the order reference. */
  orderId: string;
  /** Customer email (the recipient). */
  email: string;
  /** Maximum number of activations allowed. */
  maxActivations: number;
  /** Support contact address, from `SUPPORT_EMAIL` env. */
  supportEmail: string;
}

function render(template: string, vars: LicenseEmailVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const placeholderKey = key as keyof LicenseEmailVars;
    if (placeholderKey in vars) {
      return String(vars[placeholderKey]);
    }
    return match;
  });
}

export interface SendLicenseEmailInput {
  to: string;
  fromAddress: string;
  subject: string;
  bodyHtml: string;
  vars: Omit<LicenseEmailVars, "supportEmail"> & { supportEmail?: string };
}

export async function sendLicenseEmail(input: SendLicenseEmailInput): Promise<void> {
  // Fill in supportEmail from env if the caller didn't supply it.
  const { supportEmail: inputSupport, ...rest } = input.vars;
  const vars: LicenseEmailVars = {
    ...rest,
    supportEmail: inputSupport ?? env.SUPPORT_EMAIL,
  };
  const subject = render(input.subject, vars);
  const html = render(input.bodyHtml, vars);

  const { error } = await resend.emails.send({
    from: input.fromAddress,
    to: input.to,
    subject,
    html,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}

/**
 * Stubs used in dev/test to avoid hitting the real Resend API. The webhook
 * handler will call this in place of sendLicenseEmail when RESEND_API_KEY
 * looks like the placeholder.
 */
export function isResendStubMode(): boolean {
  return env.RESEND_API_KEY.startsWith("re_dev") || env.RESEND_API_KEY === "re_replace_me";
}

export async function stubSendLicenseEmail(input: SendLicenseEmailInput): Promise<void> {
  // Stub mode also needs a fully-typed `LicenseEmailVars` for `render()`.
  const { supportEmail: inputSupport, ...rest } = input.vars;
  const vars: LicenseEmailVars = {
    ...rest,
    supportEmail: inputSupport ?? env.SUPPORT_EMAIL,
  };
  const subject = render(input.subject, vars);
  const body = render(input.bodyHtml, vars);
  console.info(
    `[email-stub] to=${input.to} from=${input.fromAddress} subject="${subject}"\n${body}\n---`
  );
}
