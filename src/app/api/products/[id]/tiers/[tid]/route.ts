import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSessionEmail } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const paramsSchema = z.object({
  id: z.string().min(1),
  tid: z.string().min(1),
});

const patchSchema = z.object({
  plan: z.string().min(1).max(40).optional(),
  paddlePriceId: z.string().max(120).optional().nullable(),
  // expiresInDays is intentionally NOT in the PATCH schema — it's
  // immutable post-creation. Changing it on an existing tier would
  // silently shift expires_at on every license already issued under it.
});

/**
 * Edit a PriceTier.
 *
 * Only `plan` and `paddlePriceId` are editable. `expiresInDays` is locked
 * because changing it retroactively changes the expiry of every license
 * issued under this tier — see docs/plans/price-tiers.md for why.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; tid: string }> }
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

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const existing = await prisma.productPriceTier.findUnique({
    where: { id: paramsParsed.data.tid },
    select: { id: true, productId: true },
  });
  if (!existing || existing.productId !== paramsParsed.data.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const updated = await prisma.productPriceTier.update({
      where: { id: existing.id },
      data: parsed.data,
    });
    return NextResponse.json({ ok: true, tier: updated });
  } catch (err) {
    // P2002 happens when the new plan or paddlePriceId collides with an
    // existing tier on the same product. Distinguish which one collided.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "plan_or_paddlePriceId_already_exists" },
        { status: 409 }
      );
    }
    throw err;
  }
}

/**
 * Delete a PriceTier.
 *
 * Refuses if any License still references it — admins should
 * reassign or revoke those licenses first. (We don't auto-revoke because
 * the customer's signature would suddenly stop verifying, which is
 * worse than a hard refusal.)
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string; tid: string }> }
) {
  const session = await getSessionEmail();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const paramsParsed = paramsSchema.safeParse(await context.params);
  if (!paramsParsed.success) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  const existing = await prisma.productPriceTier.findUnique({
    where: { id: paramsParsed.data.tid },
    select: {
      id: true,
      productId: true,
      _count: { select: { licenses: true } },
    },
  });
  if (!existing || existing.productId !== paramsParsed.data.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (existing._count.licenses > 0) {
    return NextResponse.json(
      {
        error: "tier_has_licenses",
        licenseCount: existing._count.licenses,
      },
      { status: 409 }
    );
  }

  await prisma.productPriceTier.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}