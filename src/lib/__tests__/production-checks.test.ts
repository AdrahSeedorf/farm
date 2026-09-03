import { describe, it, expect } from 'vitest';
import {
  checkCollection,
  productionThresholdsFrom,
  pointOfLayAgeFrom,
  DEFAULT_PRODUCTION_THRESHOLDS,
  type CollectionCheckInput,
} from '../production-checks';
import type { Grade } from '../production';

const grades: Grade[] = [
  { key: 'large', name: 'Large', isSaleable: true, sortOrder: 1 },
  { key: 'medium', name: 'Medium', isSaleable: true, sortOrder: 2 },
  { key: 'cracked', name: 'Cracked', isSaleable: false, sortOrder: 3 },
];

/**
 * An unremarkable afternoon collection: 1,000 birds well into lay, 800 eggs on
 * the day, much the same as yesterday. Nothing here should say anything.
 */
const base: CollectionCheckInput = {
  birdsAlive: 1000,
  ageDays: 200,
  quantity: 400,
  earlierToday: 400,
  lines: [],
  grades,
  countedQuantity: null,
  productionStarted: true,
  pointOfLayAgeDays: 126,
  previousDayTotal: 820,
  standardHenDayPct: null,
  eggsClearOn: null,
};

const check = (overrides: Partial<CollectionCheckInput> = {}) =>
  checkCollection({ ...base, ...overrides });

const messages = (overrides: Partial<CollectionCheckInput> = {}) =>
  check(overrides).map((w) => w.message).join(' ');

describe('an ordinary collection', () => {
  it('says nothing at all', () => {
    expect(check()).toEqual([]);
  });

  it('never throws, whatever it is given', () => {
    expect(() =>
      check({ birdsAlive: 0, quantity: 99_999, earlierToday: 0, previousDayTotal: 0 }),
    ).not.toThrow();
  });
});

describe('more eggs than there are birds', () => {
  it('is flagged as impossible, and names the likeliest mistake', () => {
    const text = messages({ quantity: 1200, earlierToday: 0 });
    expect(text).toMatch(/1,200 today from 1,000 birds/);
    expect(text).toMatch(/at most one egg a day/i);
    expect(text).toMatch(/crates rather than eggs/i);
  });

  it('counts the whole day, not just this collection', () => {
    // 600 is unremarkable on its own; it is the third such collection today.
    expect(messages({ quantity: 600, earlierToday: 900 })).toMatch(/1,500 today from 1,000 birds/);
  });

  it('warns rather than refusing — the entry still saves', () => {
    const warnings = check({ quantity: 1200, earlierToday: 0 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].field).toBe('quantity');
  });
});

describe('a day that is remarkable but not impossible', () => {
  it('flags production above the ceiling as extraordinary', () => {
    // 990 from 1,000 birds is 99% lay — possible, and worth checking twice.
    expect(messages({ quantity: 990, earlierToday: 0 })).toMatch(
      /99% lay, which is extraordinary rather than impossible/i,
    );
  });

  it('says nothing at a good but ordinary rate', () => {
    expect(check({ quantity: 940, earlierToday: 0, previousDayTotal: null })).toEqual([]);
  });
});

describe('eggs and the stage record', () => {
  it('flags eggs arriving before the configured start of lay', () => {
    const text = messages({
      ageDays: 100,
      quantity: 100,
      earlierToday: 0,
      productionStarted: false,
      previousDayTotal: null,
    });
    expect(text).toMatch(/Day 100 is earlier than the day 126/);
    expect(text).toMatch(/record the stage change/i);
  });

  it('flags a flock that is producing while its stage still says it is not', () => {
    expect(
      messages({ productionStarted: false, previousDayTotal: null }),
    ).toMatch(/cost per point-of-lay pullet cannot be worked out/i);
  });

  it('says nothing about age when no start of lay has been configured', () => {
    expect(check({ ageDays: 100, pointOfLayAgeDays: null, productionStarted: false })).toEqual([]);
  });
});

describe('a flock in lay that produced nothing', () => {
  it('is flagged, because zero is a finding rather than a blank', () => {
    expect(messages({ quantity: 0, earlierToday: 0, previousDayTotal: null })).toMatch(
      /No eggs recorded for a flock in lay/i,
    );
  });

  it('is not flagged for a flock that is not laying yet', () => {
    expect(
      check({
        quantity: 0,
        earlierToday: 0,
        ageDays: 100,
        productionStarted: false,
        previousDayTotal: null,
      }),
    ).toEqual([]);
  });
});

describe('a drop against yesterday', () => {
  it('is flagged once it passes the configured share', () => {
    const text = messages({ quantity: 300, earlierToday: 400, previousDayTotal: 1000 });
    expect(text).toMatch(/down 30% on yesterday \(1,000 → 700\)/);
    expect(text).toMatch(/water, the light hours/i);
  });

  it('is quiet about the ordinary daily wobble', () => {
    expect(check({ quantity: 400, earlierToday: 400, previousDayTotal: 880 })).toEqual([]);
  });

  it('has nothing to compare against on the first recorded day', () => {
    expect(check({ previousDayTotal: null })).toEqual([]);
  });
});

describe('how it graded', () => {
  it('flags an unsaleable share above the configured rate', () => {
    const text = messages({
      quantity: 1000,
      earlierToday: 0,
      birdsAlive: 1200,
      previousDayTotal: null,
      lines: [
        { gradeKey: 'large', quantity: 620 },
        { gradeKey: 'medium', quantity: 300 },
        { gradeKey: 'cracked', quantity: 80 },
      ],
    });
    expect(text).toMatch(/8% of these graded as unsaleable \(80 of 1,000\)/);
    expect(text).toMatch(/nest boxes/i);
  });

  it('is quiet about the ordinary breakage of a well-run house', () => {
    expect(
      check({
        quantity: 1000,
        earlierToday: 0,
        birdsAlive: 1200,
        previousDayTotal: null,
        lines: [
          { gradeKey: 'large', quantity: 700 },
          { gradeKey: 'medium', quantity: 270 },
          { gradeKey: 'cracked', quantity: 30 },
        ],
      }),
    ).toEqual([]);
  });
});

describe('the house count against the grading bench', () => {
  const graded = [
    { gradeKey: 'large', quantity: 600 },
    { gradeKey: 'medium', quantity: 380 },
    { gradeKey: 'cracked', quantity: 20 },
  ];

  it('flags eggs that left the house and never reached the bench', () => {
    expect(
      messages({
        quantity: 1010,
        earlierToday: 0,
        birdsAlive: 1200,
        previousDayTotal: null,
        countedQuantity: 1010,
        lines: graded,
      }),
    ).toMatch(/10 fewer graded than were counted in the house \(1,010 counted, 1,000 graded\)/);
  });

  it('flags a collection that looks as though it was graded twice', () => {
    expect(
      messages({
        quantity: 990,
        earlierToday: 0,
        birdsAlive: 1200,
        previousDayTotal: null,
        countedQuantity: 990,
        lines: graded,
      }),
    ).toMatch(/10 more graded than were counted/);
  });

  it('says nothing when the two agree', () => {
    expect(
      check({
        quantity: 1000,
        earlierToday: 0,
        birdsAlive: 1200,
        previousDayTotal: null,
        countedQuantity: 1000,
        lines: graded,
      }),
    ).toEqual([]);
  });
});

describe('against the breed’s published curve', () => {
  it('says how many points behind the flock is', () => {
    expect(
      messages({
        quantity: 700,
        earlierToday: 0,
        previousDayTotal: null,
        standardHenDayPct: 92,
      }),
    ).toMatch(/70% lay against the 92% the breed guide gives for day 200 — 22 points behind/);
  });

  it('is quiet when the flock is close to the curve', () => {
    expect(check({ standardHenDayPct: 85, previousDayTotal: null })).toEqual([]);
  });

  it('MAKES NO COMPARISON AT ALL when no curve has been loaded', () => {
    // The system does not invent a target in order to have something to judge.
    expect(check({ quantity: 100, earlierToday: 0, previousDayTotal: null, standardHenDayPct: null }))
      .toEqual([]);
  });
});

describe('a flock under an egg withdrawal', () => {
  const warnings = check({ eggsClearOn: new Date('2027-07-14T00:00:00.000Z') });

  it('still records the collection — the eggs exist', () => {
    expect(warnings).toHaveLength(1);
    expect(warnings[0].field).toBe('disposition');
  });

  it('names the date, and says the eggs cannot go into saleable stock', () => {
    expect(warnings[0].message).toMatch(/until 2027-07-14/);
    expect(warnings[0].message).toMatch(/cannot be sold/i);
    expect(warnings[0].message).toMatch(/will not let them into saleable stock/i);
  });

  it('says nothing when the collection is empty', () => {
    expect(
      check({
        quantity: 0,
        earlierToday: 0,
        previousDayTotal: null,
        productionStarted: false,
        eggsClearOn: new Date('2027-07-14T00:00:00.000Z'),
      }),
    ).toEqual([]);
  });
});

describe('thresholds are configuration, not code', () => {
  it('falls back to the documented defaults', () => {
    expect(productionThresholdsFrom(null)).toEqual(DEFAULT_PRODUCTION_THRESHOLDS);
    expect(productionThresholdsFrom({ unrelated: true })).toEqual(DEFAULT_PRODUCTION_THRESHOLDS);
  });

  it('reads what the production type has configured', () => {
    expect(
      productionThresholdsFrom({
        henDayCeilingPct: 95,
        eggDropAlertPctDaily: 10,
        rejectRateAlertPct: 3,
        standardShortfallAlertPoints: 5,
      }),
    ).toEqual({
      henDayCeilingPct: 95,
      dayDropPct: 10,
      rejectRatePct: 3,
      standardShortfallPoints: 5,
    });
  });

  it('ignores a configured value that is not a number', () => {
    expect(productionThresholdsFrom({ eggDropAlertPctDaily: 'ten' }).dayDropPct).toBe(
      DEFAULT_PRODUCTION_THRESHOLDS.dayDropPct,
    );
  });

  it('takes a tighter drop threshold at its word', () => {
    const warnings = checkCollection(
      { ...base, quantity: 400, earlierToday: 400, previousDayTotal: 950 },
      { ...DEFAULT_PRODUCTION_THRESHOLDS, dayDropPct: 10 },
    );
    expect(warnings.map((w) => w.message).join(' ')).toMatch(/down 16% on yesterday/);
  });
});

describe('the configured start of lay', () => {
  it('is read from the production type’s standards', () => {
    expect(pointOfLayAgeFrom({ pointOfLayAgeDays: 126 })).toBe(126);
  });

  it('is nothing when nothing has been configured, rather than a guessed age', () => {
    expect(pointOfLayAgeFrom(null)).toBeNull();
    expect(pointOfLayAgeFrom({})).toBeNull();
    expect(pointOfLayAgeFrom({ pointOfLayAgeDays: 0 })).toBeNull();
    expect(pointOfLayAgeFrom({ pointOfLayAgeDays: 'sixteen weeks' })).toBeNull();
  });
});
