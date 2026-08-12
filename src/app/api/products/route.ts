import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { getSessionEmail } from "@/lib/auth";
import {
  DEFAULT_EMAIL_BODY_HTML,
  DEFAULT_EMAIL_SUBJECT,
} from "@/lib/email-default-template";
import { prisma } from "@/lib/prisma";

const productSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase a-z, 0-9, dashes"),
  description: z.string().max(2000).optional().nullable(),
  plan: z.string().min(1).max(40).default("standard"),
  paddleProductId: z.string().max(120).optional().nullable(),
  paddlePriceId: z.string().max(120).optional().nullable(),
  maxActivations: z.number().int().min(1).max(100).default(3),
  active: z.boolean().default(true),
  supportEmail: z.string().email().max(200).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const session = await getSessionEmail();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = productSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const existing = await prisma.product.findUnique({
    where: { slug: parsed.data.slug },
  });
  if (existing) {
    return NextResponse.json(
      { error: "slug_already_exists" },
      { status: 409 }
    );
  }

  try {
    // Product + default "en" template must be created together. If either
    // insert fails (e.g. unique constraint on slug, malformed template),
    // we roll back the whole thing so we never ship a product with no
    // email templates.
    const product = await prisma.$transaction(async (db) => {
      const created = await db.product.create({ data: parsed.data });
      await db.productEmailTemplate.create({
        data: {
          productId: created.id,
          locale: "en",
          displayName: "English",
          isDefault: true,
          subject: DEFAULT_EMAIL_SUBJECT,
          bodyHtml: DEFAULT_EMAIL_BODY_HTML,
        },
      });
      return created;
    });
    return NextResponse.json({ ok: true, product });
  } catch (err) {
    // Race: pre-check passed but a concurrent POST inserted the same slug
    // between findUnique and create. P2002 on `slug` → treat as 409.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "slug_already_exists" },
        { status: 409 }
      );
    }
    throw err;
  }
}
