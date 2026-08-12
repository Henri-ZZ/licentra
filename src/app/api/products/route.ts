import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { getSessionEmail } from "@/lib/auth";
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
  emailSubject: z.string().max(200).optional().nullable(),
  emailBodyHtml: z.string().max(20000).optional().nullable(),
  resendFromAddress: z.string().max(200).optional().nullable(),
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
    const product = await prisma.product.create({ data: parsed.data });
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
