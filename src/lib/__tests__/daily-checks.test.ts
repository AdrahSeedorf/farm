import { describe, it, expect } from 'vitest';
import {
  checkDailyRecord,
  thresholdsFrom,
  DEFAULT_THRESHOLDS,
} from '../daily-checks';

const base = { population: 2000, ageDays: 40, mortality: 0, culls: 0 };
const fieldsIn = (w: { field: string }[]) => w.map((x) => x.field);

describe('daily record plausibility checks', () => {
  it('says nothing about an ordinary morning', () => {
    expect(
      checkDailyRecord({ ...base, mortality: 2, feedKg: 100, waterLitres: 200 }),
    ).toEqual([]);
  });

  describe('mortality', () => {
    it('flags mortality above the configured level', () => {
      const w = checkDailyRecord({ ...base, mortality: 30 }); // 1.5% of 2000
      expect(fieldsIn(w)).toContain('mortality');
      expect(w[0].message).toMatch(/1\.5%/);
    });

    it('stays quiet just under the level', () => {
      // 0.5% of 2000 = 10 birds; 9 is under
      expect(checkDailyRecord({ ...base, mortality: 9 })).toEqual([]);
    });

    it('flags a sharp jump even when the number is small', () => {
      // 1 -> 6 is small in absolute terms but a six-fold rise
      const w = checkDailyRecord({ ...base, mortality: 6, previous: { mortality: 1 } });
      expect(w.some((x) => /well up on yesterday/.test(x.message))).toBe(true);
    });

    it('does not cry jump over trivial numbers', () => {
      expect(checkDailyRecord({ ...base, mortality: 2, previous: { mortality: 0 } })).toEqual([]);
    });

    it('flags removing more birds than the flock holds', () => {
      const w = checkDailyRecord({ ...base, population: 50, mortality: 60 });
      expect(w[0].message).toMatch(/right house/);
    });

    it('counts culls towards that impossibility check', () => {
      const w = checkDailyRecord({ ...base, population: 10, mortality: 6, culls: 6 });
      expect(w.some((x) => /right house/.test(x.message))).toBe(true);
    });
  });

  describe('feed', () => {
    it('flags a figure that looks like bags entered as kilograms', () => {
      // 500 kg across 2,000 birds = 250 g/bird
      const w = checkDailyRecord({ ...base, feedKg: 500 });
      expect(fieldsIn(w)).toContain('feedKg');
      expect(w[0].message).toMatch(/bags rather than kilograms/);
    });

    it('flags a suspiciously small amount', () => {
      const w = checkDailyRecord({ ...base, feedKg: 5 }); // 2.5 g/bird
      expect(w[0].message).toMatch(/very low/);
    });

    it('accepts a normal layer intake', () => {
      // ~110 g/bird
      expect(checkDailyRecord({ ...base, feedKg: 220 })).toEqual([]);
    });

    it('accepts a chick intake without complaint', () => {
      // day-old chicks eat around 12 g — must not be flagged as "very low"
      expect(checkDailyRecord({ ...base, ageDays: 3, feedKg: 24 })).toEqual([]);
    });
  });

  describe('water', () => {
    it('flags water far below the usual multiple of feed', () => {
      const w = checkDailyRecord({ ...base, feedKg: 200, waterLitres: 200 }); // 1.0x
      expect(fieldsIn(w)).toContain('waterLitres');
      expect(w[0].message).toMatch(/drinkers/);
    });

    it('flags water far above it, which usually means a leak', () => {
      const w = checkDailyRecord({ ...base, feedKg: 200, waterLitres: 900 }); // 4.5x
      expect(w[0].message).toMatch(/leak|stuck drinker/);
    });

    it('accepts the normal roughly two-to-one ratio', () => {
      expect(checkDailyRecord({ ...base, feedKg: 200, waterLitres: 400 })).toEqual([]);
    });

    it('flags a sharp drop against yesterday — the earliest warning a house gives', () => {
      const w = checkDailyRecord({
        ...base,
        feedKg: 200,
        waterLitres: 260,
        previous: { waterLitres: 400 },
      });
      expect(w.some((x) => /down 35% on yesterday/.test(x.message))).toBe(true);
    });

    it('does not flag a small day-to-day wobble', () => {
      const w = checkDailyRecord({
        ...base,
        feedKg: 200,
        waterLitres: 380,
        previous: { waterLitres: 400 },
      });
      expect(w).toEqual([]);
    });
  });

  describe('discipline', () => {
    it('never blocks — it only ever returns messages', () => {
      const w = checkDailyRecord({ ...base, population: 10, mortality: 500, feedKg: 9999 });
      expect(Array.isArray(w)).toBe(true);
      expect(w.length).toBeGreaterThan(0);
    });

    it('says nothing when optional figures are simply absent', () => {
      expect(
        checkDailyRecord({ ...base, mortality: 1, feedKg: null, waterLitres: null }),
      ).toEqual([]);
    });

    it('handles an empty flock without dividing by zero', () => {
      const w = checkDailyRecord({ ...base, population: 0, mortality: 0, feedKg: 10 });
      expect(w.every((x) => Number.isFinite(0) && typeof x.message === 'string')).toBe(true);
    });
  });
});

describe('thresholds from configuration', () => {
  it('uses configured values when present', () => {
    const t = thresholdsFrom({ mortalityAlertPctDaily: 0.2, feedGramsPerBirdMax: 150 });
    expect(t.mortalityAlertPctDaily).toBe(0.2);
    expect(t.feedGramsPerBirdMax).toBe(150);
    // unspecified keys fall back
    expect(t.waterToFeedMin).toBe(DEFAULT_THRESHOLDS.waterToFeedMin);
  });

  it('falls back completely when standards are missing or malformed', () => {
    expect(thresholdsFrom(null)).toEqual(DEFAULT_THRESHOLDS);
    expect(thresholdsFrom('not an object')).toEqual(DEFAULT_THRESHOLDS);
    expect(thresholdsFrom({ mortalityAlertPctDaily: 'soon' })).toEqual(DEFAULT_THRESHOLDS);
  });

  it('applies a tightened threshold', () => {
    const strict = thresholdsFrom({ mortalityAlertPctDaily: 0.1 });
    // 4 of 2000 = 0.2%, quiet by default but flagged when tightened
    expect(checkDailyRecord({ ...base, mortality: 4 })).toEqual([]);
    expect(checkDailyRecord({ ...base, mortality: 4 }, strict).length).toBe(1);
  });
});
