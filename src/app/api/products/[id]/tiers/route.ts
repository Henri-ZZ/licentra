import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { getSessionEmail } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const paramsSchema = z.object({
  id: z.string().min(1),
});

const createSchema = z.object({
  plan: z.string().min(1).max(40),
  paddlePriceId: z.string().max(120).optional().nullable(),
  // expiresInDays is intentionally NOT accepted. Lifetime-only for now;
  // see docs/plans/price-tiers.md for the unlock plan.
});

/**
 * Add a new PriceTier to a product.
 *
 * 409 on duplicate `(productId, plan)` or `(productId, paddlePriceId)` —
 * Prisma P2002.
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

  const product = await prisma.product.findUnique({
    where: { id: paramsParsed.data.id },
    select: { id: true },
  });
  if (!product) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const tier = await prisma.productPriceTier.create({
      data: {
        productId: product.id,
        plan: parsed.data.plan,
        paddlePriceId: parsed.data.paddlePriceId ?? null,
        // expiresInDays is locked at null until we turn on timed plans.
        expiresInDays: null,
      },
    });
    return NextResponse.json({ ok: true, tier });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Could be either (productId, plan) or (productId, paddlePriceId).
      // Pick the message based on which field collided — query both
      // candidate rows to decide.
      const byPlan = await prisma.productPriceTier.findUnique({
        where: {
          productId_plan: {
            productId: product.id,
            plan: parsed.data.plan,
          },
        },
        select: { id: true },
      });
      return NextResponse.json(
        {
          error: byPlan ? "plan_already_exists" : "paddlePriceId_already_exists",
        },
        { status: 409 }
      );
    }
    throw err;
  }
}