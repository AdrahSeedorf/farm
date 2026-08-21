import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  burnTime,
  describePasswordStrength,
  PasswordError,
  MIN_PASSWORD_LENGTH,
} from '../password';

describe('password hashing', () => {
  it('produces an Argon2id hash', async () => {
    const hash = await hashPassword('a-perfectly-fine-password');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verifies the correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'Correct horse battery staple')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  it('salts, so the same password never produces the same hash twice', async () => {
    const a = await hashPassword('the same password');
    const b = await hashPassword('the same password');
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'the same password')).toBe(true);
    expect(await verifyPassword(b, 'the same password')).toBe(true);
  });

  it('records its parameters in the hash, so they can be raised later', async () => {
    const hash = await hashPassword('a-perfectly-fine-password');
    expect(hash).toMatch(/\$m=\d+,t=\d+,p=\d+\$/);
  });

  it('refuses a password shorter than the minimum', async () => {
    await expect(hashPassword('short')).rejects.toThrow(PasswordError);
    await expect(hashPassword('x'.repeat(MIN_PASSWORD_LENGTH - 1))).rejects.toThrow();
    await expect(hashPassword('x'.repeat(MIN_PASSWORD_LENGTH))).resolves.toBeTruthy();
  });

  it('returns false rather than throwing on a corrupted stored hash', async () => {
    // A malformed record must not 500 — an error page is itself a signal.
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
    expect(await verifyPassword('', 'anything')).toBe(false);
    expect(await verifyPassword('$argon2id$garbage', 'anything')).toBe(false);
  });

  it('burnTime always returns false and does real work', async () => {
    // Used when the email is unknown, so a failed login takes comparable time
    // whether or not the account exists.
    const started = Date.now();
    expect(await burnTime('some-password')).toBe(false);
    expect(Date.now() - started).toBeGreaterThan(0);
  });

  it('handles long and unicode passwords', async () => {
    const long = 'ɐ'.repeat(200);
    const hash = await hashPassword(long);
    expect(await verifyPassword(hash, long)).toBe(true);
    expect(await verifyPassword(hash, long + 'x')).toBe(false);
  });
});

describe('password strength feedback', () => {
  it('rejects anything under the minimum length', () => {
    const result = describePasswordStrength('abc');
    expect(result.ok).toBe(false);
    expect(result.score).toBe(0);
  });

  it('rates a long mixed passphrase highly', () => {
    const result = describePasswordStrength('Adrah Farms Layer House 2027!');
    expect(result.ok).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(3);
  });

  it('accepts a plain long passphrase — length beats complexity rules', () => {
    const result = describePasswordStrength('greenfieldpoultryfarm');
    expect(result.ok).toBe(true);
  });
});
