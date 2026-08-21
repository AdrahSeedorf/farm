import { describe, it, expect } from 'vitest';
import { diffFields } from '../audit';

describe('audit diff', () => {
  it('records only the fields that changed', () => {
    const result = diffFields(
      { name: 'Main Farm', code: 'FARM1', region: 'Ashanti' },
      { name: 'Home Farm', code: 'FARM1', region: 'Ashanti' },
    );
    expect(result).toEqual({
      before: { name: 'Main Farm' },
      after: { name: 'Home Farm' },
    });
  });

  it('returns null when a save changed nothing — that is not an event', () => {
    expect(diffFields({ name: 'Main Farm' }, { name: 'Main Farm' })).toBeNull();
    expect(diffFields(null, null)).toBeNull();
  });

  it('NEVER records secrets, even when they changed', () => {
    const result = diffFields(
      { name: 'Kwame', passwordHash: '$argon2id$old', pinHash: '$argon2id$oldpin' },
      { name: 'Kwame Mensah', passwordHash: '$argon2id$new', pinHash: '$argon2id$newpin' },
    );
    expect(result).toEqual({ before: { name: 'Kwame' }, after: { name: 'Kwame Mensah' } });
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('argon2');
    expect(serialised).not.toContain('passwordHash');
    expect(serialised).not.toContain('pinHash');
  });

  it('strips secrets on creation too, where there is no before', () => {
    const result = diffFields(null, { name: 'New user', password: 'hunter2', token: 'abc' });
    expect(result?.after).toEqual({ name: 'New user' });
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  it('captures a field going from set to null', () => {
    const result = diffFields({ region: 'Ashanti' }, { region: null });
    expect(result).toEqual({ before: { region: 'Ashanti' }, after: { region: null } });
  });

  it('captures a field appearing for the first time', () => {
    const result = diffFields({ name: 'A' }, { name: 'A', district: 'Kwabre East' });
    expect(result).toEqual({
      before: { district: null },
      after: { district: 'Kwabre East' },
    });
  });

  it('normalises dates so an unchanged timestamp is not reported as a change', () => {
    const when = new Date('2027-01-01T00:00:00.000Z');
    expect(diffFields({ createdAt: when }, { createdAt: new Date(when) })).toBeNull();
  });

  it('detects a real date change', () => {
    const result = diffFields(
      { lastLoginAt: new Date('2027-01-01T00:00:00.000Z') },
      { lastLoginAt: new Date('2027-01-02T00:00:00.000Z') },
    );
    expect(result?.after.lastLoginAt).toBe('2027-01-02T00:00:00.000Z');
  });

  it('compares nested values structurally rather than by reference', () => {
    expect(diffFields({ meta: { a: 1 } }, { meta: { a: 1 } })).toBeNull();
    expect(diffFields({ meta: { a: 1 } }, { meta: { a: 2 } })).not.toBeNull();
  });

  it('treats a boolean flip as a change', () => {
    const result = diffFields({ isActive: true }, { isActive: false });
    expect(result).toEqual({ before: { isActive: true }, after: { isActive: false } });
  });
});
