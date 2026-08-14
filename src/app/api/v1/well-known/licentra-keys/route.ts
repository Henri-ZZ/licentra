import { NextResponse } from "next/server";

import { listPublicKeys } from "@/lib/certificate";

/**
 * Public-key discovery for Signed License Certificates (spec §9).
 *
 * Destination License systems and offline clients fetch Licentra's Ed25519
 * public keys here (the conceptual `/.well-known/licentra-keys`; the dot
 * prefix is not routable in Next.js so the path uses `well-known`). Retired
 * keys stay listed so certificates issued under an old `kid` remain
 * verifiable after rotation.
 *
 * Public and read-only: no auth, no side effects.
 */
export async function GET() {
  const keys = await listPublicKeys();
  return NextResponse.json({ keys });
}
