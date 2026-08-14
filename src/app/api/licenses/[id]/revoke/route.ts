import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSessionEmail } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
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

  const license = await prisma.license.findUnique({
    where: { id: parsedParams.data.id },
  });
  if (!license) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const reason = parsedBody.data.reason ?? "admin_action";
  const updated = await prisma.license.update({
    where: { id: license.id },
    data: {
      revoked: true,
      revokedAt: new Date(),
      revokedReason: reason,
    },
  });

  // Audit the status transition (spec §26). The License Identity is
  // unchanged — only the state moved.
  await recordAudit({
    eventType: "license.status_changed",
    licenseId: license.id,
    actor: session,
    metadata: {
      from: "active",
      to: "revoked",
      reason,
    },
  });

  return NextResponse.json({ ok: true, license: updated });
}
