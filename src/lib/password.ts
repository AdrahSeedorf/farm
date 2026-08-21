import { hash, verify, type Options } from '@node-rs/argon2';

/**
 * Password hashing — ADRAH Farms
 *
 * Argon2id, the current recommendation of the OWASP Password Storage Cheat Sheet
 * and the winner of the Password Hashing Competition. Chosen over bcrypt because
 * it is memory-hard: an attacker with a GPU farm gains far less advantage.
 *
 * We use @node-rs/argon2 (Rust, prebuilt binaries) rather than the `argon2`
 * package, which needs node-gyp and a working C++ toolchain — a dependency that
 * breaks builds on machines and CI images that have no business compiling C.
 *
 * PARAMETERS follow the OWASP baseline of 19 MiB memory, 2 iterations,
 * 1 degree of parallelism. They are recorded IN the hash string itself, so
 * raising them later does not invalidate existing passwords — `verify` reads the
 * parameters from the stored hash. `needsRehash` tells us when to upgrade one.
 */

/**
 * `Algorithm.Argon2id` is an ambient `const enum`, which TypeScript cannot read
 * under `isolatedModules` — the setting Next.js requires. So the value is
 * written literally: Argon2d = 0, Argon2i = 1, **Argon2id = 2**.
 */
const ARGON2ID = 2;

const OPTIONS: Options = {
  algorithm: ARGON2ID,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

/** Minimum length. Length beats complexity rules — NIST SP 800-63B agrees. */
export const MIN_PASSWORD_LENGTH = 10;

/** Farm staff PINs. Short by necessity, so rate limiting carries the security. */
export const PIN_LENGTH = 4;

export class PasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordError';
  }
}

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  return hash(plain, OPTIONS);
}

/**
 * Verify a password against a stored hash.
 *
 * Never throws on a bad hash — a corrupted or legacy value returns false rather
 * than a 500, so a malformed record cannot be used to probe which accounts exist.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}

/**
 * Constant-ish-time dummy verification.
 *
 * Call this when the email is not found, so a failed login takes the same
 * observable time whether or not the account exists. Without it, response timing
 * quietly turns the login form into an account enumeration oracle.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmE';

export async function burnTime(plain: string): Promise<false> {
  await verifyPassword(DUMMY_HASH, plain);
  return false;
}

/** Basic strength feedback. Advisory in the UI; only length is enforced. */
export function describePasswordStrength(plain: string): {
  ok: boolean;
  score: 0 | 1 | 2 | 3 | 4;
  message: string;
} {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      score: 0,
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  let score = 1;
  if (plain.length >= 14) score++;
  if (/[a-z]/.test(plain) && /[A-Z]/.test(plain)) score++;
  if (/\d/.test(plain) || /[^\w\s]/.test(plain)) score++;
  const clamped = Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;
  return {
    ok: true,
    score: clamped,
    message:
      clamped >= 3 ? 'Strong password.' : 'Acceptable — a longer phrase would be stronger.',
  };
}
