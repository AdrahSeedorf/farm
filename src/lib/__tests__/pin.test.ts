import { describe, it, expect } from 'vitest';
import {
  PIN_MIN_LENGTH,
  PIN_MAX_LENGTH,
  PIN_FORBIDDEN_PERMISSIONS,
  pinIsPermittedFor,
  pinErrors,
  pinStrengthSentence,
} from '../pin';
import { PIN_LIMITS, LIMITS, PIN_ATTEMPTS_PER_DAY } from '../rate-limit';
import { ROLE_PERMISSIONS, ROLES } from '../rbac';

describe('how long a PIN actually holds', () => {
  it('IS SIX DIGITS, NOT FOUR', () => {
    // Four digits is 10,000 possibilities. At 480 attempts a day, half of that
    // space falls in about ten days — a fortnight of a script nobody notices.
    // This assertion exists so a future "make it friendlier" change has to
    // argue with the arithmetic rather than just edit a constant.
    expect(PIN_MIN_LENGTH).toBe(6);
    expect(PIN_MAX_LENGTH).toBe(8);

    // The real figures, not comfortable ones. Four digits falls inside a
    // fortnight; six takes years. The upper assertion is deliberately modest —
    // it is what the arithmetic actually gives, and an earlier version of this
    // file claimed a thousand times more.
    const fourDigitDays = 10_000 / 2 / PIN_ATTEMPTS_PER_DAY;
    const sixDigitDays = 1_000_000 / 2 / PIN_ATTEMPTS_PER_DAY;
    expect(fourDigitDays).toBeLessThan(15);
    expect(sixDigitDays).toBeGreaterThan(365 * 2);
    expect(sixDigitDays).toBeLessThan(365 * 5); // and it is not more than that
  });

  it('AND THE LIMIT IS TIGHTER THAN FOR PASSWORDS, both per account and per IP', () => {
    // The per-IP figure being LOWER is the deliberate one: every staff phone on
    // the farm shares a network, so a spray across accounts looks exactly like
    // ordinary traffic unless the ceiling is low.
    expect(PIN_LIMITS.perAccount).toBeLessThan(LIMITS.perAccount);
    expect(PIN_LIMITS.perIp).toBeLessThan(LIMITS.perIp);
  });

  it('says how long in words, on the screen where a PIN is set', () => {
    expect(pinStrengthSentence(6, PIN_ATTEMPTS_PER_DAY)).toMatch(/years/);
    expect(pinStrengthSentence(4, PIN_ATTEMPTS_PER_DAY)).toMatch(/at least 6 digits/i);
  });
});

describe('what a PIN may reach', () => {
  it('A PIN NEVER BELONGS TO AN ACCOUNT THAT CAN SEE MONEY OR CHANGE ACCESS', () => {
    // This is the structural mitigation that makes a short credential
    // defensible at all. Rate limiting slows an attacker down; this bounds what
    // they get if they succeed.
    expect(pinIsPermittedFor(['owner']).allowed).toBe(false);
    expect(pinIsPermittedFor(['manager']).allowed).toBe(false);
  });

  it('and says why, in words the person setting it up can act on', () => {
    const verdict = pinIsPermittedFor(['owner']);
    expect(verdict.reason).toMatch(/cannot use a PIN/i);
    expect(verdict.reason).toMatch(/password instead/i);
  });

  it('LETS THE PEOPLE WHO ACTUALLY NEED IT HAVE ONE', () => {
    // A farmhand with no email address is the entire reason this exists. If the
    // rule above blocked them too, the feature would be pointless.
    expect(pinIsPermittedFor(['worker']).allowed).toBe(true);
    expect(pinIsPermittedFor(['supervisor']).allowed).toBe(true);
    expect(pinIsPermittedFor(['driver']).allowed).toBe(true);
  });

  it('refuses a combination even when only one role is the problem', () => {
    // Roles are additive, so a worker who is also a manager holds the manager's
    // permissions. Checking the union rather than each role is what makes that
    // safe.
    expect(pinIsPermittedFor(['worker', 'manager']).allowed).toBe(false);
  });

  it('every forbidden permission is a real one in the catalogue', () => {
    // A typo here would silently permit exactly what it was written to forbid.
    const known = new Set(ROLES.flatMap((r) => ROLE_PERMISSIONS[r]));
    for (const permission of PIN_FORBIDDEN_PERMISSIONS) {
      expect(known.has(permission), `${permission} is not held by any role`).toBe(true);
    }
  });

  it('the answer for every role, written down', () => {
    // Pinned as a table rather than described, because this is the one place in
    // the system where a role's permissions decide what CREDENTIAL it may use,
    // and a role gaining a permission later must fail here rather than silently
    // becoming reachable with six digits.
    //
    // SALES IS EXCLUDED and that is not an oversight: they take payments.
    // STOREKEEPER IS INCLUDED: they see what things cost, which is not the same
    // as seeing what the farm is worth, and they are exactly the person standing
    // in a store with a phone.
    const expected: Record<string, boolean> = {
      owner: false,
      manager: false,
      sales: false,
      supervisor: true,
      worker: true,
      storekeeper: true,
      driver: true,
      vet: true,
      customer: true,
    };
    for (const role of ROLES) {
      expect(pinIsPermittedFor([role]).allowed, role).toBe(expected[role]);
    }
  });
});

describe('PINs refused outright', () => {
  it('accepts an ordinary one', () => {
    expect(pinErrors('418209')).toEqual([]);
  });

  it('refuses anything that is not digits', () => {
    expect(pinErrors('41a209')[0]).toMatch(/digits only/i);
  });

  it('REFUSES FOUR DIGITS, and says what four costs', () => {
    expect(pinErrors('4182')[0]).toMatch(/between 6 and 8 digits/i);
    expect(pinErrors('4182')[0]).toMatch(/fortnight/i);
  });

  it('and anything longer than eight', () => {
    expect(pinErrors('418209571')[0]).toMatch(/between 6 and 8 digits/i);
  });

  it('REFUSES THE ONES AN ATTACKER TRIES FIRST', () => {
    // Every one of these left permitted turns a million-guess space into a
    // hundred-guess one for whoever chooses it.
    expect(pinErrors('000000')[0]).toMatch(/same digit repeated/i);
    expect(pinErrors('123456')[0]).toMatch(/straight run/i);
    expect(pinErrors('987654')[0]).toMatch(/straight run/i);
  });

  it('but not a number that merely contains a short run', () => {
    expect(pinErrors('123905')).toEqual([]);
  });

  it('REFUSES A PIN TAKEN FROM THE PERSON’S OWN NUMBER', () => {
    // It is written on the outside of the thing it protects: anyone who has the
    // phone, or has ever been rung by it, has the PIN.
    expect(pinErrors('241234', '+233241234567')[0]).toMatch(/own phone number/i);
    // Checked across every error rather than the first, because a PIN can break
    // more than one rule at once — 234567 is both a run and part of the number.
    expect(
      pinErrors('234567', '024 123 4567').some((e) => /own phone number/i.test(e)),
    ).toBe(true);
  });

  it('and is not confused by a number it does not have', () => {
    expect(pinErrors('418209', null)).toEqual([]);
    expect(pinErrors('418209')).toEqual([]);
  });

  it('reports every problem at once rather than one per attempt', () => {
    // Somebody re-entering a PIN four times because the form tells them one rule
    // at a time will pick something they can guess by the fourth go.
    expect(pinErrors('1111').length).toBeGreaterThan(1);
  });
});
