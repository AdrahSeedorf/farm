import { describe, it, expect } from 'vitest';
import { checkHealthEvent, withdrawalWarning } from '../health-checks';
import { requiredQuantity } from '../health-schedule';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const base = {
  birdsTreated: 940,
  population: 1000,
  occurredOn: d('2026-09-01'),
  today: d('2026-09-01'),
  ageDays: 30,
  eventType: 'VACCINATION',
  eggWithdrawalDays: null as number | null,
  meatWithdrawalDays: null as number | null,
  requiredBase: null as number | null,
  availableBase: null as number | null,
  itemName: null as string | null,
  storeName: null as string | null,
};

describe('checking a health event — warn, never block', () => {
  it('says nothing about an ordinary vaccination', () => {
    expect(checkHealthEvent(base)).toEqual([]);
  });

  it('notices more birds treated than the flock holds', () => {
    const w = checkHealthEvent({ ...base, birdsTreated: 1400 });
    expect(w[0].message).toMatch(/1400 birds treated, but the flock holds 1000/);
    expect(w[0].message).toMatch(/different house/);
  });

  it('allows treating fewer than the whole flock without comment', () => {
    expect(checkHealthEvent({ ...base, birdsTreated: 300 })).toEqual([]);
  });

  it('queries a date more than a month old, without refusing it', () => {
    const w = checkHealthEvent({ ...base, occurredOn: d('2026-07-01') });
    expect(w[0].message).toMatch(/dated 62 days ago/);
    // Recording late history is legitimate — the warning says so explicitly.
    expect(w[0].message).toMatch(/Recording it is right/);
  });

  it('says nothing about a record entered a week late', () => {
    expect(checkHealthEvent({ ...base, occurredOn: d('2026-08-25') })).toEqual([]);
  });

  it('NOTICES A MEDICATION WITH NO WITHDRAWAL PERIOD', () => {
    // The consequence is concrete: nothing will hold back sales.
    const w = checkHealthEvent({ ...base, eventType: 'MEDICATION' });
    expect(w[0].field).toBe('eggWithdrawalDays');
    expect(w[0].message).toMatch(/nothing will hold back sales/);
  });

  it('accepts a medication whose label states zero', () => {
    expect(
      checkHealthEvent({ ...base, eventType: 'MEDICATION', eggWithdrawalDays: 0 }),
    ).toEqual([]);
  });

  it('says nothing about a vaccination with no withdrawal', () => {
    expect(checkHealthEvent({ ...base, eventType: 'VACCINATION' })).toEqual([]);
  });

  it('names a shortfall in the store and says the record still saves', () => {
    const w = checkHealthEvent({
      ...base,
      requiredBase: 940,
      availableBase: 500,
      itemName: 'Newcastle La Sota',
      storeName: 'Farm Store',
    });
    expect(w[0].message).toMatch(/only 500 of Newcastle La Sota in Farm Store/);
    expect(w[0].message).toMatch(/needs 940/);
    expect(w[0].message).toMatch(/recorded in full/);
  });

  it('says nothing when the store can cover it', () => {
    expect(
      checkHealthEvent({
        ...base,
        requiredBase: 940,
        availableBase: 1000,
        itemName: 'Newcastle La Sota',
        storeName: 'Farm Store',
      }),
    ).toEqual([]);
  });

  it('raises every problem at once, not one at a time', () => {
    const w = checkHealthEvent({
      ...base,
      birdsTreated: 5000,
      eventType: 'MEDICATION',
      occurredOn: d('2026-06-01'),
    });
    expect(w).toHaveLength(3);
  });
});

describe('telling someone what a treatment restricts, before they save it', () => {
  it('says when eggs may be sold again', () => {
    expect(withdrawalWarning(d('2026-09-01'), 7, null)).toBe(
      'After this, eggs cannot be sold until 2026-09-08.',
    );
  });

  it('covers both eggs and meat', () => {
    expect(withdrawalWarning(d('2026-09-01'), 7, 10)).toMatch(
      /eggs cannot be sold until 2026-09-08, and birds cannot be sold for meat until 2026-09-11/,
    );
  });

  it('says nothing when no period was recorded', () => {
    expect(withdrawalWarning(d('2026-09-01'), null, null)).toBeNull();
  });

  it('says nothing for a stated zero — that is not a restriction', () => {
    expect(withdrawalWarning(d('2026-09-01'), 0, 0)).toBeNull();
  });
});

describe('how much a treatment draws from the store', () => {
  it('is birds times the planned dose', () => {
    expect(requiredQuantity(940, 1)).toBe(940);
  });

  it('DOES NOT round up to a whole vial', () => {
    // 60 doses of a 1,000-dose vial are discarded. That is waste, and it belongs
    // in the waste figures — not in this flock's treatment cost as though the
    // birds had received it.
    expect(requiredQuantity(940, 1)).not.toBe(1000);
  });
});
