import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSessionEmail } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const paramsSchema = z.object({
  id: z.string().min(1),
  tid: z.string().min(1),
});

const patchSchema = z.object({
  displayName: z.string().min(1).max(64).optional(),
  fromAddress: z.string().max(200).optional().nullable(),
  subject: z.string().min(1).max(200).optional(),
  bodyHtml: z.string().min(1).max(20000).optional(),
});

/**
 * Edit a per-language email template.
 *
 * Editing `locale` is intentionally not allowed — that would be a logical
 * delete + create and could orphan in-flight emails. To "rename" a locale,
 * delete the row and POST a new one.
 *
 * The `en` template is always-default; we forbid flipping `isDefault`
 * off it. Currently no API path allows *setting* `isDefault=true`, so
 * the only protection needed is on the existing default row.
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

  const existing = await prisma.productEmailTemplate.findUnique({
    where: { id: paramsParsed.data.tid },
    select: { id: true, productId: true, locale: true, isDefault: true },
  });
  if (!existing || existing.productId !== paramsParsed.data.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const updated = await prisma.productEmailTemplate.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  return NextResponse.json({ ok: true, template: updated });
}

/**
 * Delete a per-language email template.
 *
 * `en` is the always-present default and cannot be removed — if you want
 * to "reset" it, edit it in place (PATCH) or, in an emergency, replace
 * its contents via the database directly.
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

  const existing = await prisma.productEmailTemplate.findUnique({
    where: { id: paramsParsed.data.tid },
    select: { id: true, productId: true, locale: true, isDefault: true },
  });
  if (!existing || existing.productId !== paramsParsed.data.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (existing.locale === "en" && existing.isDefault) {
    return NextResponse.json(
      { error: "cannot_delete_default_template" },
      { status: 400 }
    );
  }

  await prisma.productEmailTemplate.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
