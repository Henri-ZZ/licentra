import { NextResponse, type NextRequest } from "next/server";

import { getSessionEmail } from "@/lib/auth";
import {
  DEFAULT_EMAIL_BODY_HTML,
  DEFAULT_EMAIL_SUBJECT,
  isResendStubMode,
  sendLicenseEmail,
  stubSendLicenseEmail,
} from "@/lib/email";
import { prisma } from "@/lib/prisma";

/**
 * Re-send the license email for a LicenseKey.
 *
 * IMPORTANT: the raw key is not stored anywhere. To re-send, the admin
 * must already have a copy (from the original send), or we generate a
 * new key + revoke the old one. v1 implementation: regenerate and revoke.
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

  const license = await prisma.licenseKey.findUnique({
    where: { id },
    include: { product: true, order: true },
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

  const customerEmail = license.order?.paddleEmail;
  if (!customerEmail) {
    return NextResponse.json(
      { error: "no_customer_email_on_order" },
      { status: 400 }
    );
  }

  // Generate a new key (the old one is unknown to us now) and revoke it.
  const { generateLicenseKey, sha256Hex } = await import("@/lib/license-key");
  const newRawKey = generateLicenseKey();
  const newHash = sha256Hex(newRawKey);

  // Find the oldest active license on the same order and revoke it.
  // For multi-license orders we'd handle differently; v1 keeps it 1:1.
  await prisma.licenseKey.update({
    where: { id: license.id },
    data: {
      revoked: true,
      revokedAt: new Date(),
      revokedReason: "resend_superseded",
    },
  });

  const newLicense = await prisma.licenseKey.create({
    data: {
      keyHash: newHash,
      productId: license.productId,
      orderId: license.orderId,
      maxActivations: license.maxActivations,
      emailedAt: null,
    },
  });

  // Send the email for the new key.
  const subject = license.product.emailSubject ?? DEFAULT_EMAIL_SUBJECT;
  const body = license.product.emailBodyHtml ?? DEFAULT_EMAIL_BODY_HTML;
  const from =
    license.product.resendFromAddress ?? "Licentra <onboarding@resend.dev>";

  try {
    const send = isResendStubMode() ? stubSendLicenseEmail : sendLicenseEmail;
    await send({
      to: customerEmail,
      fromAddress: from,
      subject,
      bodyHtml: body,
      vars: {
        key: newRawKey,
        productName: license.product.name,
        plan: license.product.plan,
        licenseId: newLicense.id,
        maxActivations: license.maxActivations,
      },
    });
    await prisma.licenseKey.update({
      where: { id: newLicense.id },
      data: { emailedAt: new Date(), emailError: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.licenseKey.update({
      where: { id: newLicense.id },
      data: { emailError: message, emailAttempts: { increment: 1 } },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, licenseId: newLicense.id });
}
