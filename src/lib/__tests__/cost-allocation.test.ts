import { describe, it, expect } from 'vitest';
import {
  ALLOCATION_METHODS,
  DEFAULT_METHOD,
  METHOD_LABELS,
  METHOD_EXPLANATION,
  methodNeedsPeriod,
  automaticSourceWarning,
  birdDaysBetween,
  daysInPeriod,
  weightsFor,
  splitAllocation,
  manualTotal,
  allocationErrors,
  checkAllocation,
  allocationSentence,
  entryDescription,
  weightLabel,
  type AllocationTarget,
} from '../cost-allocation';
import { fromCedis } from '../money';
import type { PopulationEvent } from '../ledger';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** 500 birds placed on 1 July; 20 die on the 16th. */
const houseOne: PopulationEvent[] = [
  { type: 'PLACEMENT', delta: 500, occurredOn: d('2026-07-01') },
  { type: 'MORTALITY', delta: -20, occurredOn: d('2026-07-16') },
];

/** 300 birds placed on 25 July — seven days of the month, the 25th included. */
const houseTwo: PopulationEvent[] = [
  { type: 'PLACEMENT', delta: 300, occurredOn: d('2026-07-25') },
];

describe('bird-days', () => {
  it('counts population on every day of the window, both ends included', () => {
    // 15 days at 500 (1st–15th) + 16 days at 480 (16th–31st).
    expect(birdDaysBetween(houseOne, d('2026-07-01'), d('2026-07-31'))).toBe(
      15 * 500 + 16 * 480,
    );
  });

  it('COUNTS ONLY THE DAYS THE BIRDS WERE THERE', () => {
    // The whole reason this method is the default: a flock placed on the 25th
    // was on the farm for seven days of July, not thirty-one.
    expect(birdDaysBetween(houseTwo, d('2026-07-01'), d('2026-07-31'))).toBe(7 * 300);
  });

  it('is zero for a flock that had not been placed yet', () => {
    expect(birdDaysBetween(houseTwo, d('2026-06-01'), d('2026-06-30'))).toBe(0);
  });

  it('counts the placement day itself', () => {
    expect(birdDaysBetween(houseTwo, d('2026-07-25'), d('2026-07-25'))).toBe(300);
  });

  it('never goes negative, whatever the ledger says', () => {
    const overdrawn: PopulationEvent[] = [
      { type: 'PLACEMENT', delta: 10, occurredOn: d('2026-07-01') },
      { type: 'ADJUSTMENT', delta: -40, occurredOn: d('2026-07-02') },
    ];
    expect(birdDaysBetween(overdrawn, d('2026-07-01'), d('2026-07-05'))).toBe(10);
  });

  it('returns nothing for a backwards window', () => {
    expect(birdDaysBetween(houseOne, d('2026-07-31'), d('2026-07-01'))).toBe(0);
  });

  it('counts days inclusively', () => {
    expect(daysInPeriod(d('2026-07-01'), d('2026-07-31'))).toBe(31);
    expect(daysInPeriod(d('2026-07-01'), d('2026-07-01'))).toBe(1);
    expect(daysInPeriod(d('2026-07-31'), d('2026-07-01'))).toBe(0);
  });
});

describe('the four methods', () => {
  const targets: AllocationTarget[] = [
    { flockId: 'a', label: 'House 1', birdDays: 15_180, headcount: 480 },
    { flockId: 'b', label: 'House 2', birdDays: 2_100, headcount: 300 },
  ];

  it('has a label and an explanation for every one', () => {
    for (const m of ALLOCATION_METHODS) {
      expect(METHOD_LABELS[m].length).toBeGreaterThan(0);
      expect(METHOD_EXPLANATION[m].length).toBeGreaterThan(20);
    }
  });

  it('defaults to bird-days', () => {
    expect(DEFAULT_METHOD).toBe('BIRD_DAYS');
  });

  it('asks for a period only when the method uses one', () => {
    expect(methodNeedsPeriod('BIRD_DAYS')).toBe(true);
    expect(methodNeedsPeriod('HEADCOUNT')).toBe(false);
    expect(methodNeedsPeriod('EQUAL')).toBe(false);
    expect(methodNeedsPeriod('MANUAL')).toBe(false);
  });

  it('weighs by bird-days', () => {
    expect(weightsFor('BIRD_DAYS', targets)).toEqual([15_180, 2_100]);
  });

  it('weighs by headcount', () => {
    expect(weightsFor('HEADCOUNT', targets)).toEqual([480, 300]);
  });

  it('weighs everything the same when equal', () => {
    expect(weightsFor('EQUAL', targets)).toEqual([1, 1]);
  });

  it('GIVES A DIFFERENT ANSWER PER METHOD, WHICH IS THE POINT', () => {
    const bill = fromCedis(1_000);
    const byDays = splitAllocation(bill, 'BIRD_DAYS', targets);
    const byHead = splitAllocation(bill, 'HEADCOUNT', targets);
    const equally = splitAllocation(bill, 'EQUAL', targets);

    // House 2 arrived on the 25th. Headcount says it should
    // carry nearly two fifths of the wage bill; bird-days says an eighth.
    expect(byDays[1].pesewas).toBeLessThan(byHead[1].pesewas);
    expect(byHead[1].pesewas).toBeLessThan(equally[1].pesewas);
  });
});

describe('dividing the money', () => {
  const targets: AllocationTarget[] = [
    { flockId: 'a', label: 'House 1', birdDays: 15_180, headcount: 480 },
    { flockId: 'b', label: 'House 2', birdDays: 2_100, headcount: 300 },
  ];

  it('sums EXACTLY to the bill, with no pesewa lost', () => {
    const bill = fromCedis(1_000);
    const lines = splitAllocation(bill, 'BIRD_DAYS', targets);
    expect(lines.reduce((s, l) => s + l.pesewas, 0)).toBe(bill);
  });

  it('sums exactly even on a total that will not divide', () => {
    // GHS 10.00 three ways is 333.33 pesewas each, which does not exist.
    const three: AllocationTarget[] = ['a', 'b', 'c'].map((id) => ({
      flockId: id,
      label: id,
      birdDays: 100,
      headcount: 10,
    }));
    const lines = splitAllocation(fromCedis(10), 'EQUAL', three);
    expect(lines.map((l) => l.pesewas)).toEqual([334, 333, 333]);
    expect(lines.reduce((s, l) => s + l.pesewas, 0)).toBe(1000);
  });

  it('divides in proportion to the weights', () => {
    const lines = splitAllocation(fromCedis(1_000), 'BIRD_DAYS', targets);
    // 15,180 of 17,280 bird-days is 87.85%.
    expect(lines[0].sharePct).toBeCloseTo(87.85, 1);
    expect(lines[1].sharePct).toBeCloseTo(12.15, 1);
  });

  it('keeps the weight on each line so the split can be checked later', () => {
    const lines = splitAllocation(fromCedis(1_000), 'BIRD_DAYS', targets);
    expect(lines[0].weight).toBe(15_180);
  });

  it('gives everything to a single flock', () => {
    const lines = splitAllocation(fromCedis(480), 'BIRD_DAYS', [targets[0]]);
    expect(lines).toHaveLength(1);
    expect(lines[0].pesewas).toBe(fromCedis(480));
  });

  it('uses typed amounts as given, unrounded, when manual', () => {
    const manual: AllocationTarget[] = [
      { ...targets[0], manualPesewas: fromCedis(700) },
      { ...targets[1], manualPesewas: fromCedis(300) },
    ];
    const lines = splitAllocation(fromCedis(1_000), 'MANUAL', manual);
    expect(lines.map((l) => l.pesewas)).toEqual([70_000, 30_000]);
    expect(manualTotal(manual)).toBe(fromCedis(1_000));
  });

  it('returns nothing when no flock was chosen', () => {
    expect(splitAllocation(fromCedis(100), 'EQUAL', [])).toEqual([]);
  });
});

describe('what will not be written', () => {
  const targets: AllocationTarget[] = [
    { flockId: 'a', label: 'House 1', birdDays: 15_180, headcount: 480 },
  ];
  const base = {
    category: 'LABOUR' as const,
    totalPesewas: fromCedis(1_000),
    method: 'BIRD_DAYS' as const,
    targets,
    periodStart: d('2026-07-01'),
    periodEnd: d('2026-07-31'),
  };

  it('accepts a sound allocation', () => {
    expect(allocationErrors(base)).toEqual([]);
  });

  it('refuses a split with no flock in it', () => {
    expect(allocationErrors({ ...base, targets: [] })[0]).toMatch(/at least one flock/i);
  });

  it('refuses a zero or negative amount', () => {
    expect(allocationErrors({ ...base, totalPesewas: 0 })[0]).toMatch(/more than zero/i);
  });

  it('refuses bird-days without a period', () => {
    expect(allocationErrors({ ...base, periodStart: null })[0]).toMatch(/needs the period/i);
  });

  it('refuses a period that ends before it starts', () => {
    expect(
      allocationErrors({ ...base, periodStart: d('2026-07-31'), periodEnd: d('2026-07-01') }),
    ).toContainEqual(expect.stringMatching(/ends before it starts/i));
  });

  it('REFUSES MANUAL SHARES THAT DO NOT ADD UP TO THE BILL', () => {
    // A ledger whose parts do not sum to the invoice is worse than no ledger,
    // because it looks like one.
    const errors = allocationErrors({
      ...base,
      method: 'MANUAL',
      targets: [
        { ...targets[0], manualPesewas: fromCedis(400) },
        { flockId: 'b', label: 'House 2', birdDays: 0, headcount: 0, manualPesewas: fromCedis(500) },
      ],
    });
    expect(errors[0]).toMatch(/900\.00/);
    expect(errors[0]).toMatch(/1,000\.00/);
    expect(errors[0]).toMatch(/short/i);
  });

  it('says "over" when the shares exceed the bill', () => {
    const errors = allocationErrors({
      ...base,
      method: 'MANUAL',
      targets: [{ ...targets[0], manualPesewas: fromCedis(1_200) }],
    });
    expect(errors[0]).toMatch(/over/i);
  });
});

describe('what is said before saving', () => {
  const targets: AllocationTarget[] = [
    { flockId: 'a', label: 'House 1', birdDays: 15_180, headcount: 480 },
    { flockId: 'b', label: 'House 2', birdDays: 0, headcount: 0 },
  ];
  const base = {
    category: 'LABOUR' as const,
    totalPesewas: fromCedis(1_000),
    method: 'BIRD_DAYS' as const,
    targets: [targets[0]],
    periodStart: d('2026-07-01'),
    periodEnd: d('2026-07-31'),
  };

  it('says nothing about a plain labour cost', () => {
    expect(checkAllocation(base)).toEqual([]);
  });

  it('WARNS THAT FEED IS ALREADY CHARGED FROM THE STORE', () => {
    const w = checkAllocation({ ...base, category: 'FEED' });
    expect(w[0].message).toMatch(/already recorded/i);
    expect(w[0].message).toMatch(/charged twice/i);
  });

  it('warns the same for health and chicks', () => {
    expect(automaticSourceWarning('HEALTH')).not.toBeNull();
    expect(automaticSourceWarning('STOCK_PURCHASE')).not.toBeNull();
  });

  it('does not warn for the categories nothing else writes', () => {
    for (const c of ['LABOUR', 'UTILITIES', 'TRANSPORT', 'OTHER'] as const) {
      expect(automaticSourceWarning(c)).toBeNull();
    }
  });

  it('names a flock that will carry nothing', () => {
    const w = checkAllocation({ ...base, targets });
    expect(w.some((x) => x.message.includes('House 2'))).toBe(true);
    expect(w.some((x) => /carry none of this cost/i.test(x.message))).toBe(true);
  });

  it('warns loudly when NO flock has any weight, because the split falls back to equal', () => {
    const w = checkAllocation({ ...base, targets: [targets[1]] });
    expect(w[0].message).toMatch(/divided equally instead/i);
  });

  it('and the fallback really does split equally rather than throwing', () => {
    const lines = splitAllocation(fromCedis(100), 'BIRD_DAYS', [
      targets[1],
      { flockId: 'c', label: 'House 3', birdDays: 0, headcount: 0 },
    ]);
    expect(lines.map((l) => l.pesewas)).toEqual([5_000, 5_000]);
  });

  it('queries a period longer than a quarter', () => {
    const w = checkAllocation({ ...base, periodEnd: d('2026-12-31') });
    expect(w.some((x) => /more than a quarter/i.test(x.message))).toBe(true);
  });

  it('does not query an ordinary month', () => {
    expect(checkAllocation(base)).toEqual([]);
  });
});

describe('saying what was done', () => {
  const lines = splitAllocation(fromCedis(1_000), 'BIRD_DAYS', [
    { flockId: 'a', label: 'House 1', birdDays: 15_180, headcount: 480 },
    { flockId: 'b', label: 'House 2', birdDays: 2_100, headcount: 300 },
  ]);

  it('writes the whole split as one sentence', () => {
    const s = allocationSentence(fromCedis(1_000), 'BIRD_DAYS', lines);
    expect(s).toMatch(/1,000\.00 across 2 flocks by bird-days/);
    expect(s).toMatch(/House 1/);
    expect(s).toMatch(/House 2/);
  });

  it('does not talk about splitting when there was nothing to split', () => {
    const one = splitAllocation(fromCedis(480), 'EQUAL', [
      { flockId: 'a', label: 'House 1', birdDays: 1, headcount: 1 },
    ]);
    expect(allocationSentence(fromCedis(480), 'EQUAL', one)).toBe(
      'GHS 480.00, all of it to House 1.',
    );
  });

  it('makes each flock’s own entry explain itself', () => {
    expect(entryDescription('Electricity, July', 'BIRD_DAYS', 3)).toBe(
      'Electricity, July — 1 of 3 flocks, by bird-days',
    );
  });

  it('leaves a single-flock entry alone', () => {
    expect(entryDescription('Casual labour', 'EQUAL', 1)).toBe('Casual labour');
  });

  it('labels a weight by what it actually counted', () => {
    expect(weightLabel('BIRD_DAYS', 15_180)).toMatch(/bird-days/);
    expect(weightLabel('HEADCOUNT', 480)).toMatch(/birds$/);
    expect(weightLabel('EQUAL', 1)).toBe('equal share');
    expect(weightLabel('MANUAL', 40_000)).toBe('entered by hand');
  });
});
