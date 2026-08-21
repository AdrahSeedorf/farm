import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 configuration — ADRAH Farms
 *
 * In Prisma 7 the connection URL no longer lives in schema.prisma. Migrate and
 * introspection read it from here; the application reads it through a driver
 * adapter in src/lib/db.ts.
 *
 * POOLED vs DIRECT — why there are two URLs
 *
 *   Neon (and Supabase) put a connection pooler in front of Postgres. The pooler
 *   is what the application should talk to at runtime: it multiplexes many short
 *   serverless requests onto few real connections.
 *
 *   But Prisma Migrate performs DDL and needs a *direct*, unpooled connection —
 *   schema changes through a transaction pooler fail in confusing ways. So
 *   migrations deliberately prefer DIRECT_DATABASE_URL and fall back to
 *   DATABASE_URL for local setups where there is only one.
 *
 * TWO PRISMA 7 CHANGES THAT BITE HERE
 *
 *   1. It no longer loads `.env` automatically. We do it explicitly below.
 *
 *   2. `env('DATABASE_URL')` THROWS when the variable is missing — at
 *      config-load time, before Prisma looks at which command you ran. That
 *      breaks `npm install` on a fresh clone, because `postinstall` runs
 *      `prisma generate` before anyone has created a `.env`. `generate` needs no
 *      database, so we read the variables plainly and let them be undefined.
 */

// Node 20.12+. Guarded so an older runtime degrades instead of crashing.
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env yet — expected on a fresh clone, and fine for `prisma generate`.
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Migrations: direct connection when one exists, otherwise the only one there is.
    url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
    // Scratch database for diffing schema changes. Neon and Supabase provision
    // this automatically, so it stays unset there. `prisma dev` exposes one on
    // the next port up — see .env.example.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
