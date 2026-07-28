/**
 * Prisma client singleton.
 *
 * Next.js dev-mode hot reload re-evaluates modules on every edit; without the
 * global cache each reload would open a fresh connection pool until Postgres
 * refuses new connections.
 */

import { PrismaClient } from "@prisma/client";
import { loadEnv } from "./loadEnv";

// Next populates `.env` itself; this only does anything for scripts and tests
// run directly through tsx, which have no such loader.
loadEnv();

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
