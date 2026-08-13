import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { getSessionEmail } from "@/lib/auth";
import { isValidLocaleCode } from "@/lib/locale";
import { prisma } from "@/lib/prisma";

const localeSchema = z
  .string()
  .min(1)
  .max(8)
  .refine(isValidLocaleCode, {
    message: "locale must be 2-3 lowercase letters (e.g. en, zh, ja)",
  });

const createSchema = z.object({
  locale: localeSchema,
  displayName: z.string().min(1).max(64),
  fromAddress: z.string().max(200).optional().nullable(),
  fromName: z.string().max(200).optional().nullable(),
  subject: z.string().min(1).max(200),
  bodyHtml: z.string().min(1).max(20000),
});

const paramsSchema = z.object({
  id: z.string().min(1),
});

/**
 * Add a new per-language email template to a product.
 *
 * - Rejects `en` (the default template already exists and is the only
 *   default allowed; it must be edited, not recreated).
 * - 409 on duplicate `(productId, locale)` — Prisma P2002.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSessionEmail();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const paramsParsed = paramsSchema.safeParse(await context.params);
  if (!paramsParsed.success) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  if (parsed.data.locale === "en") {
    // English is the always-present default. Use PATCH on the existing
    // English row to edit it instead of POSTing a new one.
    return NextResponse.json(
      { error: "english_template_already_exists" },
      { status: 409 }
    );
  }

  const product = await prisma.product.findUnique({
    where: { id: paramsParsed.data.id },
    select: { id: true },
  });
  if (!product) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const template = await prisma.productEmailTemplate.create({
      data: {
        productId: product.id,
        locale: parsed.data.locale,
        displayName: parsed.data.displayName,
        isDefault: false,
        fromAddress: parsed.data.fromAddress ?? null,
        fromName: parsed.data.fromName ?? null,
        subject: parsed.data.subject,
        bodyHtml: parsed.data.bodyHtml,
      },
    });
    return NextResponse.json({ ok: true, template });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "locale_already_exists" },
        { status: 409 }
      );
    }
    throw err;
  }
}
