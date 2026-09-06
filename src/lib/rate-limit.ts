import { db } from '@/lib/db';
// PIN_LIMITS lives in pin.ts, alongside the arithmetic that justifies it and
// away from anything that touches the database — a client component needs the
// numbers, and importing this file to get them drags the Postgres driver into
// the browser bundle. Re-exported so callers reaching for a rate limit still
// find both in one place.
export { PIN_LIMITS, PIN_ATTEMPTS_PER_DAY } from '@/lib/pin';

/**
 * Sign-in rate limiting — ADRAH Farms
 *
 * Database-backed, not in-memory. An in-memory counter resets on every deploy
 * and is per-instance; on serverless that means an attacker distributing
 * requests across instances faces effectively no limit at all.
 *
 * Two independent limits, because they stop different attacks:
 *
 *   PER ACCOUNT  — someone guessing one person's password.
 *   PER IP       — someone spraying one common password across many accounts,
 *                  which never trips a per-account limit.
 *
 * Deliberately NOT a hard account lockout: locking an account on failed attempts
 * hands anyone a denial-of-service against any user whose email they know. A
 * cooling-off window that clears itself is the right shape here.
 */

export const LIMITS = {
  /** Failed attempts against one identifier before the cooling-off applies. */
  perAccount: 8,
  /** Failed attempts from one IP across any accounts. */
  perIp: 25,
  /** Rolling window, in minutes. */
  windowMinutes: 15,
} as const;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may try again. Only meaningful when blocked. */
  retryAfterSeconds: number;
}

/** Check both limits before verifying any password. */
export async function checkLoginRateLimit(
  identifier: string,
  ipAddress: string | null,
  limits: { perAccount: number; perIp: number; windowMinutes: number } = LIMITS,
): Promise<RateLimitResult> {
  const since = new Date(Date.now() - limits.windowMinutes * 60_000);
  const key = identifier.trim().toLowerCase();

  const [accountFailures, ipFailures] = await Promise.all([
    db.loginAttempt.count({
      where: { identifier: key, successful: false, createdAt: { gte: since } },
    }),
    ipAddress
      ? db.loginAttempt.count({
          where: { ipAddress, successful: false, createdAt: { gte: since } },
        })
      : Promise.resolve(0),
  ]);

  const blocked = accountFailures >= limits.perAccount || ipFailures >= limits.perIp;
  if (!blocked) return { allowed: true, retryAfterSeconds: 0 };

  // Time until the oldest failure in the window falls out of it.
  const oldest = await db.loginAttempt.findFirst({
    where: {
      successful: false,
      createdAt: { gte: since },
      ...(accountFailures >= limits.perAccount
        ? { identifier: key }
        : { ipAddress: ipAddress ?? undefined }),
    },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });

  const expiresAt = oldest
    ? oldest.createdAt.getTime() + limits.windowMinutes * 60_000
    : Date.now() + limits.windowMinutes * 60_000;

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)),
  };
}

export async function recordLoginAttempt(input: {
  identifier: string;
  successful: boolean;
  ipAddress: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await db.loginAttempt.create({
    data: {
      identifier: input.identifier.trim().toLowerCase(),
      successful: input.successful,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent?.slice(0, 255) ?? null,
    },
  });
}

/**
 * Clear an account's failures after a successful sign-in, so a person who
 * mistypes twice then succeeds starts the next day with a clean slate.
 */
export async function clearAccountFailures(identifier: string): Promise<void> {
  await db.loginAttempt.deleteMany({
    where: { identifier: identifier.trim().toLowerCase(), successful: false },
  });
}

/**
 * Housekeeping for the scheduled job added in Milestone 13. Attempt records are
 * a security control with a short useful life, not history worth keeping.
 */
export async function pruneOldLoginAttempts(olderThanDays = 30): Promise<number> {
  const { count } = await db.loginAttempt.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - olderThanDays * 86_400_000) } },
  });
  return count;
}
