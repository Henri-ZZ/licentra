import { NextResponse, type NextRequest } from "next/server";

import { getSessionEmail } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import {
  isResendStubMode,
  sendLicenseEmail,
  stubSendLicenseEmail,
} from "@/lib/email";
import { pickTemplate } from "@/lib/locale";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

const FALLBACK_FROM = "Licentra <onboarding@resend.dev>";

/**
 * Re-send the license email for a License.
 *
 * The raw key is never stored anywhere, so a re-send issues a NEW key.
 * CRITICAL (spec §4 / §27.2): this ROTATES the credential hash IN PLACE on
 * the same License row — `id` (the License Identity), device activations,
 * tier snapshot and migration fields are all preserved. We never create a
 * new License row for a key rotation, and never treat the key hash as the
 * identity. The old key stops matching the stored hash immediately, which
 * is the intended invalid state.
 *
 * Template selection: prefer the customer's `Order.locale` (captured at
 * Paddle checkout) over the admin's browser locale. Falls back to the
 * product's `isDefault` template (always `en`).
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSessionEmail();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const license = await prisma.license.findUnique({
    where: { id },
    include: {
      product: { include: { templates: true } },
      order: true,
    },
  });
  if (!license || !license.product) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (!license.product.privateKeyEncrypted) {
    return NextResponse.json(
      { error: "product_has_no_signing_key" },
      { status: 400 }
    );
  }

  const customerEmail = license.order?.paddleEmail ?? license.email;
  if (!customerEmail) {
    return NextResponse.json(
      { error: "no_customer_email_on_order" },
      { status: 400 }
    );
  }

  // Generate a fresh credential and rotate the hash on the SAME License
  // row — identity (id), activations and migration fields are untouched.
  const { generateLicenseKey, sha256Hex } = await import("@/lib/license-key");
  const newRawKey = generateLicenseKey();
  const newHash = sha256Hex(newRawKey);

  await prisma.license.update({
    where: { id: license.id },
    data: {
      keyHash: newHash,
      emailedAt: null,
      emailError: null,
      emailAttempts: 0,
    },
  });

  // Pick template + resolve fallback chain: per-template → hard-coded Resend
  // dev default. The product's `en` template is guaranteed by the create +
  // backfill flows, so reaching the hard-coded default means something went
  // wrong upstream.
  const tpl = pickTemplate(license.product.templates, license.order?.locale ?? null);
  const fromAddress = tpl?.fromAddress ?? FALLBACK_FROM;
  const subject = tpl?.subject ?? "";
  const bodyHtml = tpl?.bodyHtml ?? "";

  try {
    const send = isResendStubMode() ? stubSendLicenseEmail : sendLicenseEmail;
    await send({
      to: customerEmail,
      fromAddress,
      subject,
      bodyHtml,
      vars: {
        code: newRawKey,
        productName: license.product.name,
        plan: license.plan ?? "",
        orderId: license.orderId ?? license.id,
        email: customerEmail,
        maxActivations: license.maxActivations,
        supportEmail: license.product.supportEmail ?? env.SUPPORT_EMAIL,
      },
    });
    await prisma.license.update({
      where: { id: license.id },
      data: { emailedAt: new Date(), emailError: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.license.update({
      where: { id: license.id },
      data: { emailError: message, emailAttempts: { increment: 1 } },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Audit the credential rotation (spec §26). License Identity unchanged.
  await recordAudit({
    eventType: "license.key_rotated",
    licenseId: license.id,
    actor: session,
    metadata: { reason: "resend_email" },
  });

  return NextResponse.json({ ok: true, licenseId: license.id });
}
