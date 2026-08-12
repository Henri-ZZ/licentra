import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSessionEmail } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional().nullable(),
  plan: z.string().min(1).max(40).optional(),
  paddleProductId: z.string().max(120).optional().nullable(),
  paddlePriceId: z.string().max(120).optional().nullable(),
  maxActivations: z.number().int().min(1).max(100).optional(),
  active: z.boolean().optional(),
  emailSubject: z.string().max(200).optional().nullable(),
  emailBodyHtml: z.string().max(20000).optional().nullable(),
  resendFromAddress: z.string().max(200).optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSessionEmail();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const updated = await prisma.product.update({
    where: { id },
    data: parsed.data,
  });
  return NextResponse.json({ ok: true, product: updated });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSessionEmail();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const existing = await prisma.product.findUnique({
    where: { id },
    include: { licenses: { take: 1 } },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (existing.licenses.length > 0) {
    return NextResponse.json(
      { error: "product_has_licenses" },
      { status: 409 }
    );
  }

  await prisma.product.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
