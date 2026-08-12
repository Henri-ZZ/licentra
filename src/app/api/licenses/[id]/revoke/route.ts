import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSessionEmail } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const paramsSchema = z.object({
  id: z.string().min(1),
});

const bodySchema = z.object({
  reason: z.string().max(200).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSessionEmail();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine */
  }
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const license = await prisma.licenseKey.findUnique({
    where: { id: parsedParams.data.id },
  });
  if (!license) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const updated = await prisma.licenseKey.update({
    where: { id: license.id },
    data: {
      revoked: true,
      revokedAt: new Date(),
      revokedReason: parsedBody.data.reason ?? "admin_action",
    },
  });

  return NextResponse.json({ ok: true, license: updated });
}
