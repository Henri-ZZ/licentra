import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { getSessionEmail } from "@/lib/auth";
import {
  DEFAULT_EMAIL_BODY_HTML,
  DEFAULT_EMAIL_SUBJECT,
} from "@/lib/email-default-template";
import { prisma } from "@/lib/prisma";

const tierInputSchema = z.object({
  plan: z.string().min(1).max(40),
  paddlePriceId: z.string().max(120).optional().nullable(),
  // expiresInDays is intentionally NOT accepted on create yet — see
  // docs/plans/price-tiers.md. The webhook only supports lifetime today.
  // The column is reserved so the schema doesn't need another migration
  // when we turn it on.
});

const productSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase a-z, 0-9, dashes"),
  description: z.string().max(2000).optional().nullable(),
  paddleProductId: z.string().max(120).optional().nullable(),
  maxActivations: z.number().int().min(1).max(100).default(3),
  signatureTtlSeconds: z.number().int().min(60).max(31536000).default(86400),
  active: z.boolean().default(true),
  supportEmail: z.string().email().max(200).optional().nullable(),
  // The first tier is created atomically with the product so the row is
  // never sellable-without-a-tier. Admins can add more tiers from the
  // product edit page.
  tiers: z.array(tierInputSchema).min(1).max(20).default([]),
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
    // Product + default "en" template + first price tier must all land
    // together. If any insert fails we roll back the whole thing so we
    // never ship a product that's missing either an email template or a
    // tier the webhook could resolve to.
    const product = await prisma.$transaction(async (db) => {
      const created = await db.product.create({
        data: {
          name: parsed.data.name,
          slug: parsed.data.slug,
          description: parsed.data.description,
          paddleProductId: parsed.data.paddleProductId,
          maxActivations: parsed.data.maxActivations,
          signatureTtlSeconds: parsed.data.signatureTtlSeconds,
          active: parsed.data.active,
          supportEmail: parsed.data.supportEmail,
        },
      });
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
      // expiresInDays is always null today (lifetime-only). Hard-coded so
      // we can't accidentally write a non-null value through this path.
      for (const tier of parsed.data.tiers) {
        await db.productPriceTier.create({
          data: {
            productId: created.id,
            plan: tier.plan,
            paddlePriceId: tier.paddlePriceId ?? null,
            expiresInDays: null,
          },
        });
      }
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
