import { describe, it, expect } from 'vitest';
import {
  totalCost,
  costUpTo,
  byCategory,
  costPerBird,
  costPerBirdPlaced,
  mortalityCostPerBird,
  costPerBirdPerDay,
  polCost,
  versusBoughtPullet,
  missingCategories,
  completenessNote,
  runningTotals,
  costSpan,
  CATEGORY_LABELS,
  COST_CATEGORIES,
  type CostEntry,
} from '../flock-costing';
import { formatGHS, pesewas, fromCedis } from '../money';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** A rearing cycle, in round figures so the arithmetic checks by eye. */
const entries: CostEntry[] = [
  { category: 'STOCK_PURCHASE', amountPesewas: fromCedis(12_000), incurredOn: d('2026-04-01') },
  { category: 'FEED', amountPesewas: fromCedis(28_000), incurredOn: d('2026-06-15') },
  { category: 'FEED', amountPesewas: fromCedis(9_000), incurredOn: d('2026-08-20') },
  { category: 'HEALTH', amountPesewas: fromCedis(3_000), incurredOn: d('2026-05-10') },
  { category: 'LABOUR', amountPesewas: fromCedis(6_000), incurredOn: d('2026-07-01') },
];

describe('what a flock has cost', () => {
  it('adds it up in pesewas', () => {
    expect(totalCost(entries)).toBe(5_800_000);
    expect(formatGHS(totalCost(entries))).toMatch(/58,000/);
  });

  it('adds up to a date, for the split between rearing and lay', () => {
    // Everything to 30 June: chicks + first feed + health = GHS 43,000.
    expect(costUpTo(entries, d('2026-06-30'))).toBe(fromCedis(43_000));
  });

  it('includes anything dated on the cutoff day itself', () => {
    expect(costUpTo(entries, d('2026-06-15'))).toBe(fromCedis(43_000));
    expect(costUpTo(entries, d('2026-06-14'))).toBe(fromCedis(15_000));
  });

  it('is nothing when nothing has been spent', () => {
    expect(totalCost([])).toBe(0);
  });
});

describe('where the money went', () => {
  const split = byCategory(entries);

  it('groups and orders by size, because that is the question being asked', () => {
    expect(split.map((c) => c.category)).toEqual([
      'FEED',
      'STOCK_PURCHASE',
      'LABOUR',
      'HEALTH',
    ]);
  });

  it('adds the two feed deliveries together', () => {
    expect(split[0].pesewas).toBe(fromCedis(37_000));
  });

  it('gives each a share of the total', () => {
    expect(split[0].sharePct).toBeCloseTo(63.79, 1);
    const sum = split.reduce((s, c) => s + (c.sharePct ?? 0), 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  it('leaves out categories with nothing in them', () => {
    expect(split.map((c) => c.category)).not.toContain('UTILITIES');
  });

  it('has a label for every category', () => {
    for (const c of COST_CATEGORIES) expect(CATEGORY_LABELS[c].length).toBeGreaterThan(0);
  });
});

describe('cost per bird — and why mortality shows up in it', () => {
  const total = fromCedis(58_000);

  it('divides by the birds STILL ALIVE', () => {
    // 1,000 placed, 940 alive: GHS 61.70 each.
    expect(costPerBird(total, 940)).toBe(6170);
  });

  it('and separately by the birds placed, for comparison', () => {
    expect(costPerBirdPlaced(total, 1000)).toBe(5800);
  });

  it('PUTS A CEDI FIGURE ON THE MORTALITY', () => {
    // 6% mortality is a statistic. "Every surviving pullet costs GHS 3.70 more"
    // is a decision.
    const extra = mortalityCostPerBird(total, 1000, 940);
    expect(extra).toBe(370);
    expect(formatGHS(pesewas(extra!))).toMatch(/3\.70/);
  });

  it('shows nothing extra when nothing died', () => {
    expect(mortalityCostPerBird(total, 1000, 1000)).toBe(0);
  });

  it('grows sharply as mortality does', () => {
    const light = mortalityCostPerBird(total, 1000, 960)!;
    const heavy = mortalityCostPerBird(total, 1000, 800)!;
    expect(heavy).toBeGreaterThan(light * 3);
  });

  it('returns null rather than infinity for an empty flock', () => {
    expect(costPerBird(total, 0)).toBeNull();
    expect(costPerBirdPlaced(total, 0)).toBeNull();
    expect(mortalityCostPerBird(total, 0, 0)).toBeNull();
  });

  it('gives a daily rate for planning', () => {
    // GHS 61.70 over 140 days is about 44 pesewas a day.
    expect(costPerBirdPerDay(total, 940, 140)).toBeCloseTo(44.07, 1);
  });

  it('refuses to divide by no days', () => {
    expect(costPerBirdPerDay(total, 940, 0)).toBeNull();
  });
});

describe('reading the ledger', () => {
  it('runs oldest first, so the total counts up', () => {
    const rows = runningTotals(entries);
    expect(rows.map((r) => r.entry.incurredOn.toISOString().slice(0, 10))).toEqual([
      '2026-04-01',
      '2026-05-10',
      '2026-06-15',
      '2026-07-01',
      '2026-08-20',
    ]);
    expect(rows.map((r) => r.runningPesewas)).toEqual([
      fromCedis(12_000),
      fromCedis(15_000),
      fromCedis(43_000),
      fromCedis(49_000),
      fromCedis(58_000),
    ]);
  });

  it('ends on the same figure as the total', () => {
    const rows = runningTotals(entries);
    expect(rows[rows.length - 1].runningPesewas).toBe(totalCost(entries));
  });

  it('A REVERSAL PULLS THE RUNNING TOTAL BACK DOWN', () => {
    // Corrections are negative rows, not deletions. Someone checking against
    // their receipts has to be able to see the mistake and the fix.
    const withReversal: CostEntry[] = [
      ...entries,
      { category: 'LABOUR', amountPesewas: -fromCedis(6_000), incurredOn: d('2026-08-25') },
    ];
    const rows = runningTotals(withReversal);
    expect(rows[rows.length - 1].runningPesewas).toBe(fromCedis(52_000));
    expect(byCategory(withReversal).find((c) => c.category === 'LABOUR')?.pesewas).toBe(0);
  });

  it('does not mutate what it was given', () => {
    const copy = [...entries];
    runningTotals(entries);
    expect(entries).toEqual(copy);
  });

  it('is empty for a flock with no costs', () => {
    expect(runningTotals([])).toEqual([]);
    expect(costSpan([])).toBeNull();
  });

  it('reports the first and last day money went out', () => {
    const span = costSpan(entries)!;
    expect(span.first.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(span.last.toISOString().slice(0, 10)).toBe('2026-08-20');
  });
});

describe('cost per point-of-lay pullet', () => {
  /**
   * The figure the whole milestone exists for: what it cost to build one laying
   * bird, and therefore whether rearing from day-old beat buying ready-to-lay.
   */
  const pol = polCost(entries, d('2026-08-25'), 940, 146);

  it('counts everything spent up to the day lay began', () => {
    expect(pol.rearingCostPesewas).toBe(fromCedis(58_000));
  });

  it('divides by the pullets that actually reached it', () => {
    expect(pol.costPerPulletPesewas).toBe(6170);
    expect(formatGHS(pesewas(pol.costPerPulletPesewas!))).toMatch(/61\.70/);
  });

  it('EXCLUDES anything spent after lay began — that is trading, not rearing', () => {
    const withLayFeed = [
      ...entries,
      { category: 'FEED' as const, amountPesewas: fromCedis(20_000), incurredOn: d('2026-09-15') },
    ];
    expect(polCost(withLayFeed, d('2026-08-25'), 940, 146).rearingCostPesewas).toBe(
      fromCedis(58_000),
    );
  });

  it('uses the flock’s OWN date, not a standard age', () => {
    // A flock that took three weeks longer cost three weeks more to get there.
    const late = polCost(entries, d('2026-09-15'), 940, 167);
    expect(late.ageDaysAtPol).toBe(167);
    expect(late.rearingCostPesewas).toBe(fromCedis(58_000));
  });

  it('says nothing when no pullets reached lay', () => {
    expect(polCost(entries, d('2026-08-25'), 0, 146).costPerPulletPesewas).toBeNull();
  });

  describe('against buying ready-to-lay', () => {
    it('reports the difference, negative when rearing won', () => {
      // Reared at GHS 61.70 against a market pullet at GHS 75.
      expect(versusBoughtPullet(6170, fromCedis(75))).toBe(-1330);
    });

    it('and positive when it did not', () => {
      expect(versusBoughtPullet(6170, fromCedis(55))).toBe(670);
    });

    it('REFUSES TO GUESS A MARKET PRICE', () => {
      // A stale pullet price baked into software would be worse than a blank:
      // it moves with the season and the supplier.
      expect(versusBoughtPullet(6170, null)).toBeNull();
    });
  });
});

describe('saying what has NOT been recorded', () => {
  it('names the categories nobody has entered', () => {
    expect(missingCategories(entries)).toEqual(['UTILITIES', 'TRANSPORT']);
  });

  it('writes it as a sentence that admits the total is low', () => {
    expect(completenessNote(entries)).toBe(
      'No utilities and transport cost has been recorded, so this total is lower than the real one.',
    );
  });

  it('handles a single missing category', () => {
    const withUtilities = [
      ...entries,
      { category: 'UTILITIES' as const, amountPesewas: 100, incurredOn: d('2026-07-01') },
      { category: 'TRANSPORT' as const, amountPesewas: 100, incurredOn: d('2026-07-01') },
    ];
    expect(completenessNote(withUtilities)).toBeNull();
    expect(
      completenessNote(withUtilities.filter((e) => e.category !== 'TRANSPORT')),
    ).toMatch(/No transport cost/);
  });

  it('does not nag about chicks or feed', () => {
    // A flock with neither is a flock nobody has started recording.
    expect(missingCategories([])).not.toContain('FEED');
    expect(missingCategories([])).not.toContain('STOCK_PURCHASE');
  });
});
