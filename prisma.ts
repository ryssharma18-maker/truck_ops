import { PrismaClient } from "@prisma/client";

// Reuse the client across hot reloads in dev, and across warm serverless
// invocations in prod, so we don't exhaust the Postgres connection pool.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
