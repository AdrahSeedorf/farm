import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

/**
 * Database client — ADRAH Farms
 *
 * Prisma 7 with the node-postgres driver adapter. No Rust query engine binary
 * ships with the app, which keeps deploys small and works cleanly on serverless.
 *
 * TWO DELIBERATE CHOICES HERE:
 *
 * 1. THE CLIENT IS CREATED LAZILY, on first use rather than on import.
 *    `next build` imports every module it can reach in order to analyse it. If
 *    this file threw at import time on a missing DATABASE_URL, the build would
 *    fail on any machine or CI job that has no database configured — even though
 *    building does not need one. Failing on first *query* instead puts the error
 *    where the problem actually is.
 *
 * 2. THE CLIENT IS CACHED ON globalThis IN DEVELOPMENT.
 *    Next.js hot reload re-evaluates modules on every edit; without this you
 *    exhaust the database connection pool after a dozen saves.
 */

const globalForPrisma = globalThis as unknown as {
  __adrahPrisma?: PrismaClient;
};

function getClient(): PrismaClient {
  if (globalForPrisma.__adrahPrisma) return globalForPrisma.__adrahPrisma;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and fill it in — ' +
        'see the README for local setup.',
    );
  }

  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  // Cache in every environment: in development to survive hot reload, in
  // production simply so the client is a singleton.
  globalForPrisma.__adrahPrisma = client;
  return client;
}

/**
 * The database client. Behaves exactly like a PrismaClient — `db.user.findMany()`
 * and so on — but the underlying connection is not opened until the first access.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient() as unknown as Record<string | symbol, unknown>;
    const value = client[property];
    // Bind methods so `this` still refers to the real client, not the proxy.
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
