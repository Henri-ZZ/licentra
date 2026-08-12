import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSessionEmail } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { publicKeyFingerprint } from "@/lib/fingerprint";
import { generateKeyPair } from "@/lib/license-sign";
import { prisma } from "@/lib/prisma";

const paramsSchema = z.object({
  id: z.string().min(1),
});

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSessionEmail();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  const product = await prisma.product.findUnique({
    where: { id: parsed.data.id },
  });
  if (!product) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { privateKeyPem, publicKeyPem } = generateKeyPair();
  const privateKeyEncrypted = encrypt(privateKeyPem);
  const fp = publicKeyFingerprint(publicKeyPem);

  await prisma.product.update({
    where: { id: product.id },
    data: {
      privateKeyEncrypted,
      publicKey: publicKeyPem,
      publicKeyFingerprint: fp,
    },
  });

  return NextResponse.json({
    ok: true,
    publicKey: publicKeyPem,
    publicKeyFingerprint: fp,
  });
}
