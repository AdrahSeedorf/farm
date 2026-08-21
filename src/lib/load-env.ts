/**
 * Load `.env` for standalone scripts — ADRAH Farms
 *
 * Next.js loads `.env` automatically. Plain Node does not, so anything run
 * through `tsx` (the seed, the password tool, future maintenance jobs) starts
 * with an empty `process.env` and fails with a confusing "DATABASE_URL is not
 * set" even though the file is sitting right there.
 *
 * Import this FIRST, before anything that reads an environment variable:
 *
 *   import '@/lib/load-env';
 *
 * Existing variables always win, so `DATABASE_URL=... npm run <script>` still
 * overrides the file — which is how CI and one-off production commands work.
 */

if (typeof process.loadEnvFile === 'function') {
  for (const file of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Not present — expected. `.env.local` is optional, and in CI neither exists.
    }
  }
}

export {};
