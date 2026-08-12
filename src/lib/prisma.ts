import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

import { env } from "@/lib/env";

/**
 * Prisma client singleton. Re-uses the instance across hot reloads in dev
 * so we don't exhaust Neon connections.
 *
 * Uses Neon's serverless driver via @prisma/adapter-neon. This works in both
 * long-running Node servers (Neon TCP) and edge runtimes (Neon WebSocket).
 */

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaNeon({ connectionString: env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma = global.__prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}