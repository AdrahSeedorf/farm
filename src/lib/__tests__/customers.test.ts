import { describe, it, expect } from 'vitest';
import {
  displayName,
  comparablePhone,
  samePhone,
  duplicateWarning,
  customerErrors,
  archiveErrors,
  sortCustomers,
  matches,
  customerSummary,
  isArchived,
  type Customer,
} from '@/lib/customers';

const NOW = new Date('2026-09-10T09:00:00.000Z');
const DAY = 86_400_000;

function customer(over: Partial<Customer> = {}): Customer {
  return {
    id: over.id ?? 'c1',
    name: over.name ?? 'Akosua Mensah',
    phone: over.phone ?? '+233244778899',
    kind: over.kind ?? 'RETAIL',
    businessName: over.businessName ?? null,
    email: over.email ?? null,
    town: over.town ?? null,
    notes: over.notes ?? null,
    fromEnquiryId: over.fromEnquiryId ?? null,
    createdAt: over.createdAt ?? NOW,
    createdByName: over.createdByName ?? null,
    archivedAt: over.archivedAt ?? null,
    archivedByName: over.archivedByName ?? null,
    archiveReason: over.archiveReason ?? null,
  };
}

describe('the phone number is the identity', () => {
  // The same buyer written three ways. A duplicate check that compares strings
  // finds none of these, and the farm ends up with three rows for one person.
  it('NORMALISES BEFORE COMPARING', () => {
    expect(comparablePhone('0244778899')).toBe('+233244778899');
    expect(comparablePhone('+233 24 477 8899')).toBe('+233244778899');
    expect(comparablePhone('233244778899')).toBe('+233244778899');
  });

  it('treats those three as the same number', () => {
    expect(samePhone('0244778899', '+233 24 477 8899')).toBe(true);
    expect(samePhone('233244778899', '0244778899')).toBe(true);
  });

  it('does not collapse two different numbers', () => {
    expect(samePhone('0244778899', '0244778890')).toBe(false);
  });

  // A number this software cannot parse is still a number a person can ring, so
  // it falls back to the digits rather than being discarded.
  it('still compares a number it cannot parse', () => {
    expect(samePhone('+44 7700 900123', '+447700900123')).toBe(true);
  });

  it('never treats two blanks as a match', () => {
    expect(samePhone('', '')).toBe(false);
    expect(samePhone('abc', 'def')).toBe(false);
  });
});

describe('a duplicate', () => {
  // WARNED ABOUT, NEVER BLOCKED. Two businesses genuinely share a number, and
  // refusing the second sends whoever is at the counter into inventing a digit.
  it('NAMES WHO ALREADY HOLDS THE NUMBER, and offers a way out', () => {
    const warning = duplicateWarning('0244778899', [
      { id: 'c9', name: 'Akosua', businessName: 'Mensah Provisions' },
    ]);
    expect(warning?.customerId).toBe('c9');
    expect(warning?.message).toContain('Mensah Provisions');
    expect(warning?.message).toContain('Akosua');
    expect(warning?.message).toMatch(/Open them instead/);
  });

  it('says both will be kept if they really are different', () => {
    const warning = duplicateWarning('0244778899', [
      { id: 'c9', name: 'Akosua', businessName: null },
    ]);
    expect(warning?.message).toMatch(/will keep both/);
  });

  it('is nothing when nobody matches', () => {
    expect(duplicateWarning('0244778899', [])).toBeNull();
  });
});

describe('what a buyer needs', () => {
  // TWO FIELDS. This gets filled in at a counter with somebody waiting.
  it('IS A NAME AND A NUMBER, AND NOTHING ELSE', () => {
    expect(customerErrors({ name: 'Akosua', phone: '0244778899' })).toEqual([]);
  });

  it('refuses a blank name', () => {
    expect(customerErrors({ name: '', phone: '0244778899' })[0]).toMatch(/name/i);
    expect(customerErrors({ name: ' A ', phone: '0244778899' })[0]).toMatch(/name/i);
  });

  it('refuses something that is not a number', () => {
    expect(customerErrors({ name: 'Akosua', phone: '' })[0]).toMatch(/reach them/i);
    expect(customerErrors({ name: 'Akosua', phone: 'call me' })[0]).toMatch(/reach them/i);
  });

  it('accepts a foreign number rather than turning the buyer away', () => {
    expect(customerErrors({ name: 'Akosua', phone: '+44 7700 900123' })).toEqual([]);
  });
});

describe('putting one aside', () => {
  it('needs a reason', () => {
    expect(archiveErrors('')).toHaveLength(1);
    expect(archiveErrors('Closed the shop')).toEqual([]);
  });

  // "Closed the shop" and "duplicate of Mensah Provisions" are different facts,
  // and only one of them means the balance should have been chased.
  it('says what kind of reason it wants', () => {
    expect(archiveErrors('')[0]).toMatch(/duplicate|closed/i);
  });
});

describe('the list', () => {
  it('names the business first where there is one', () => {
    expect(displayName(customer({ businessName: 'Mensah Provisions' }))).toBe(
      'Mensah Provisions · Akosua Mensah',
    );
    expect(displayName(customer())).toBe('Akosua Mensah');
  });

  it('sinks the ones put aside', () => {
    const aside = customer({ id: 'aside', archivedAt: NOW });
    const open = customer({ id: 'open', createdAt: new Date(NOW.getTime() - 5 * DAY) });
    expect(sortCustomers([aside, open]).map((c) => c.id)).toEqual(['open', 'aside']);
    expect(isArchived(aside)).toBe(true);
  });

  it('puts the most recently added first', () => {
    const older = customer({ id: 'older', createdAt: new Date(NOW.getTime() - 5 * DAY) });
    const newer = customer({ id: 'newer', createdAt: NOW });
    expect(sortCustomers([older, newer]).map((c) => c.id)).toEqual(['newer', 'older']);
  });
});

describe('searching', () => {
  const c = customer({
    name: 'Akosua Mensah',
    businessName: 'Mensah Provisions',
    town: 'Obuasi',
    phone: '+233244778899',
  });

  it('matches a name, a business or a town', () => {
    expect(matches(c, 'akosua')).toBe(true);
    expect(matches(c, 'provisions')).toBe(true);
    expect(matches(c, 'obuasi')).toBe(true);
    expect(matches(c, 'kumasi')).toBe(false);
  });

  // Somebody searching by phone has almost certainly copied it from WhatsApp,
  // where it is +233…, while the record may hold 024…
  it('MATCHES A NUMBER HOWEVER IT IS WRITTEN', () => {
    expect(matches(c, '0244778899')).toBe(true);
    expect(matches(c, '+233 24 477 8899')).toBe(true);
    expect(matches(c, '233244778899')).toBe(true);
  });

  it('shows everything for an empty search', () => {
    expect(matches(c, '')).toBe(true);
    expect(matches(c, '   ')).toBe(true);
  });
});

describe('the summary line', () => {
  it('says how to get started when the list is empty', () => {
    expect(customerSummary([])).toMatch(/turn an enquiry into one/i);
  });

  it('counts the wholesale buyers separately', () => {
    const list = [
      customer({ id: 'a', kind: 'WHOLESALE' }),
      customer({ id: 'b', kind: 'RETAIL' }),
    ];
    expect(customerSummary(list)).toBe('2 buyers, 1 wholesale.');
  });

  it('does not count the ones put aside', () => {
    const list = [customer({ id: 'a' }), customer({ id: 'b', archivedAt: NOW })];
    expect(customerSummary(list)).toBe('1 buyer.');
  });
});
