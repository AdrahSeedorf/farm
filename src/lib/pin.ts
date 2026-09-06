import type { Permission, Role } from '@/lib/rbac';
import { ROLE_PERMISSIONS } from '@/lib/rbac';

/**
 * PIN policy — ADRAH Farms
 *
 * Pure rules. No database, no hashing — see password.ts for those.
 *
 * WHY A PIN EXISTS AT ALL
 *   Most farmhands in New Edubiase have a phone and no email address, and asking
 *   somebody in a poultry house at half five in the morning to type a fourteen-
 *   character passphrase on a cracked screen with wet hands is asking for the
 *   password to end up written on the wall. A PIN is the credential people will
 *   actually use, and a credential people use badly is worse than a weaker one
 *   they use properly.
 *
 * WHY THAT IS NOT AN EXCUSE FOR A WEAK SYSTEM
 *   A PIN is short, so the security cannot come from the secret. It comes from
 *   three things together, and removing any one of them breaks the argument:
 *
 *     1. SIX DIGITS, NOT FOUR. See PIN_MIN_LENGTH below.
 *     2. RATE LIMITING, tighter than for passwords. See rate-limit.ts.
 *     3. A CEILING ON WHAT A PIN CAN REACH. A PIN never belongs to an account
 *        that can see money, set prices or change who has access. See
 *        `pinIsPermittedFor` — this is the one that matters most, and it is
 *        enforced when the PIN is set, not merely recommended in a comment.
 */

/**
 * Six digits, not four.
 *
 * THE ARITHMETIC, worked out rather than asserted — the first version of this
 * comment claimed six digits bought "about three thousand years" and the test
 * below caught that it is nothing of the sort. The real figures:
 *
 *   The PIN limit is 5 attempts per 15 minutes against one account, so 480 a
 *   day if somebody grinds continuously and never stops.
 *
 *     FOUR digits   10,000 possibilities   →  about 10 days to reach half
 *     SIX digits    1,000,000              →  about 2.9 years to reach half
 *     EIGHT digits  100,000,000            →  about 285 years
 *
 * Ten days is a fortnight of a script nobody notices. Three years is a different
 * proposition, and it is not the only thing standing in the way: the per-IP cap
 * bites long before that for anyone attacking from one place, every attempt is
 * logged, and `pinIsPermittedFor` bounds what a success is worth.
 *
 * THREE YEARS IS NOT "SAFE FOREVER", and this comment deliberately does not
 * pretend otherwise. Eight digits is available to anyone who wants it, and if
 * this farm ever puts something genuinely valuable behind a PIN account, the
 * honest answer is to raise the minimum rather than to re-round the arithmetic.
 *
 * Ghanaian mobile money PINs are four digits, and somebody will point that out.
 * They are also bound to a SIM in a specific handset and enforced by the network.
 * This one is typed into a web form from anywhere in the world, which is a
 * different threat model wearing the same clothes.
 *
 * Nothing longer than eight, because a "PIN" people cannot hold in their head
 * becomes a password written on the wall.
 */
export const PIN_MIN_LENGTH = 6;
export const PIN_MAX_LENGTH = 8;

/**
 * The same shape, tighter, for PIN sign-in.
 *
 * A PIN is six digits — a million possibilities against a password's effectively
 * unbounded space — so the limit is doing far more of the work here and has to
 * be set accordingly. Five attempts in fifteen minutes is 480 a day, which puts
 * half of a six-digit space about 2.9 years away. See PIN_MIN_LENGTH in pin.ts
 * for the full arithmetic and for why that number is stated rather than rounded
 * up into a comfortable one.
 *
 * Five is also more than a farmhand needs: somebody who has genuinely forgotten
 * their PIN is not helped by a sixth guess, they are helped by the manager
 * resetting it.
 *
 * DELIBERATELY NOT AN ESCALATING LOCKOUT. Doubling the window on each block
 * would raise that 2.9 years considerably, and it would also mean the one person
 * who has to record a mortality at half five in the morning can be locked out
 * for four hours by somebody else's mistyping. The farm loses more from that
 * than it gains, and the manager reset is the escape valve either way.
 *
 * The per-IP figure is LOWER than for passwords, not higher, because every staff
 * phone on the farm shares one network and a spray across accounts is exactly
 * the attack this catches.
 */
export const PIN_LIMITS = {
  perAccount: 5,
  perIp: 15,
  windowMinutes: 15,
} as const;

/** Attempts a single account gets per day at the PIN limit — used in the wording. */
export const PIN_ATTEMPTS_PER_DAY =
  (PIN_LIMITS.perAccount * (24 * 60)) / PIN_LIMITS.windowMinutes;


/**
 * Permissions that must never sit behind a PIN.
 *
 * A short credential is acceptable for recording a mortality and unacceptable
 * for approving a payment. Rather than trusting whoever creates the next account
 * to remember that, the rule is stated here and checked when a PIN is set.
 */
export const PIN_FORBIDDEN_PERMISSIONS: Permission[] = [
  'finance:view',
  'price:edit',
  'payment:create',
  'settings:manage',
  'user:create',
  'user:edit',
  // user:edit is what changes somebody's roles, so it stands in for
  // "can change who has access" — there is no separate permission for that.
  'user:manage',
];

export interface PinVerdict {
  allowed: boolean;
  /** Why not. Written for the person setting it up, not for a log. */
  reason: string | null;
}

/**
 * May this set of roles hold a PIN?
 *
 * Refuses rather than warns. An owner who wants to sign in on a phone gets a
 * password — the inconvenience is real, and it is smaller than the alternative,
 * which is the account that can change everybody's access being reachable with
 * six digits.
 */
export function pinIsPermittedFor(roles: Role[]): PinVerdict {
  const held = new Set<string>(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []));
  const blocking = PIN_FORBIDDEN_PERMISSIONS.filter((p) => held.has(p));

  if (blocking.length === 0) return { allowed: true, reason: null };

  return {
    allowed: false,
    reason:
      'This account can see money or change who has access, so it cannot use a PIN. ' +
      'Six digits is the right credential for recording what happened in a house; it is ' +
      'the wrong one for approving a payment. Give this person a password instead.',
  };
}

/**
 * PINs refused outright, whatever the length.
 *
 * These are not a completeness exercise — they are the first few hundred an
 * attacker tries, and every one left permitted converts a million-guess space
 * into a hundred-guess one for the people who choose them.
 */
export function pinErrors(pin: string, ownPhone?: string | null): string[] {
  const errors: string[] = [];

  if (!/^\d+$/.test(pin)) {
    errors.push('A PIN is digits only.');
    return errors; // everything below assumes digits
  }

  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    errors.push(
      `A PIN is between ${PIN_MIN_LENGTH} and ${PIN_MAX_LENGTH} digits. ` +
        `Four is short enough to be guessed in about a fortnight.`,
    );
  }

  if (/^(\d)\1+$/.test(pin)) {
    errors.push('That is the same digit repeated. Choose something else.');
  }

  if (isRun(pin)) {
    errors.push('That is a straight run of digits. Choose something else.');
  }

  // A PIN taken from the person's own number is written on the outside of the
  // thing it protects — the phone they are holding.
  const digits = (ownPhone ?? '').replace(/\D/g, '');
  if (pin.length >= 4 && digits.includes(pin)) {
    errors.push('That is part of your own phone number, which anyone can read off a call log.');
  }

  return errors;
}

/** 123456, 987654 — ascending or descending by one, all the way through. */
function isRun(pin: string): boolean {
  if (pin.length < 3) return false;
  const step = Number(pin[1]) - Number(pin[0]);
  if (step !== 1 && step !== -1) return false;
  for (let i = 2; i < pin.length; i++) {
    if (Number(pin[i]) - Number(pin[i - 1]) !== step) return false;
  }
  return true;
}

/**
 * How long a PIN of this length survives the rate limit, in words.
 *
 * Shown on the screen where a PIN is set. A rule with its reasoning attached is
 * a rule that survives the next person who finds it inconvenient.
 */
export function pinStrengthSentence(length: number, attemptsPerDay: number): string {
  if (length < PIN_MIN_LENGTH) return `Too short — use at least ${PIN_MIN_LENGTH} digits.`;

  const space = 10 ** length;
  const days = space / 2 / attemptsPerDay;

  if (days >= 365) {
    const years = Math.round(days / 365);
    return `${length} digits. At the sign-in limit, guessing this would take about ${years.toLocaleString()} years.`;
  }
  return `${length} digits. At the sign-in limit, guessing this would take about ${Math.round(days)} days.`;
}
