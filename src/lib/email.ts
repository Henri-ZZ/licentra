import { Resend } from "resend";

import { env } from "@/lib/env";

/**
 * Resend email client + simple placeholder-rendering for product-specific
 * license-key delivery emails.
 *
 * Templates are stored on the Product row and use `{{key}}`, `{{productName}}`,
 * `{{plan}}`, `{{licenseId}}`, `{{maxActivations}}` placeholders.
 */

const resend = new Resend(env.RESEND_API_KEY);

export interface LicenseEmailVars {
  key: string;
  productName: string;
  plan: string;
  licenseId: string;
  maxActivations: number;
  customerEmail?: string;
}

const PLACEHOLDER_MAP: Record<keyof LicenseEmailVars, string> = {
  key: "{{key}}",
  productName: "{{productName}}",
  plan: "{{plan}}",
  licenseId: "{{licenseId}}",
  maxActivations: "{{maxActivations}}",
  customerEmail: "{{customerEmail}}",
};

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
  vars: LicenseEmailVars;
}

export async function sendLicenseEmail(input: SendLicenseEmailInput): Promise<void> {
  const subject = render(input.subject, input.vars);
  const html = render(input.bodyHtml, input.vars);

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
 * Default subject + body templates used when a Product has no override.
 * Kept generic so they work for any one-time-purchase license.
 */
export const DEFAULT_EMAIL_SUBJECT = "Your {{productName}} License Key";

export const DEFAULT_EMAIL_BODY_HTML = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h1 style="font-size: 20px; margin-bottom: 16px;">Thanks for purchasing {{productName}}!</h1>
  <p>Your license key is below. Keep it safe — we do not store the raw key and cannot retrieve it for you.</p>
  <div style="background: #f4f4f5; border-radius: 8px; padding: 16px; margin: 24px 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 16px; letter-spacing: 1px; text-align: center;">
    {{key}}
  </div>
  <p><strong>Plan:</strong> {{plan}}<br/><strong>Max devices:</strong> {{maxActivations}}</p>
  <p style="color: #71717a; font-size: 13px; margin-top: 32px;">
    License ID: {{licenseId}}
  </p>
</div>
`.trim();

/**
 * Stubs used in dev/test to avoid hitting the real Resend API. The webhook
 * handler will call this in place of sendLicenseEmail when RESEND_API_KEY
 * looks like the placeholder.
 */
export function isResendStubMode(): boolean {
  return env.RESEND_API_KEY.startsWith("re_dev") || env.RESEND_API_KEY === "re_replace_me";
}

export async function stubSendLicenseEmail(input: SendLicenseEmailInput): Promise<void> {
  const subject = render(input.subject, input.vars);
  const body = render(input.bodyHtml, input.vars);
  console.info(
    `[email-stub] to=${input.to} from=${input.fromAddress} subject="${subject}"\n${body}\n---`
  );
}
