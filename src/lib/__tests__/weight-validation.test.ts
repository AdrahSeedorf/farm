import { describe, it, expect } from 'vitest';
import { parseWeights, weightSampleSchema } from '../validation/weight';

const today = new Date().toISOString().slice(0, 10);

describe('parsing a typed list of weights', () => {
  it('accepts commas, spaces and newlines in the same entry', () => {
    // Nobody weighing 50 birds should have to think about separators.
    const r = parseWeights('1400, 1410 1395\n1405;1398');
    expect(r.weights).toEqual([1400, 1410, 1395, 1405, 1398]);
    expect(r.rejected).toEqual([]);
  });

  it('tolerates messy spacing and trailing separators', () => {
    expect(parseWeights('  1400 ,, 1410 ,  ').weights).toEqual([1400, 1410]);
  });

  it('rounds decimals — a tenth of a gram on a live bird is noise', () => {
    expect(parseWeights('1400.4 1400.6').weights).toEqual([1400, 1401]);
  });

  it('separates out anything that is not a weight, so it can be named', () => {
    const r = parseWeights('1400 abc 1410 -5 99999');
    expect(r.weights).toEqual([1400, 1410]);
    expect(r.rejected).toEqual(['abc', '-5', '99999']);
  });

  it('accepts a day-old chick and a large hen', () => {
    expect(parseWeights('38 2400').weights).toEqual([38, 2400]);
  });

  it('returns nothing for an empty entry', () => {
    expect(parseWeights('').weights).toEqual([]);
    expect(parseWeights('   ').weights).toEqual([]);
  });
});

describe('weight sample validation', () => {
  const parse = (extra: Record<string, string>) =>
    weightSampleSchema.safeParse({ takenOn: today, ...extra });

  it('accepts a normal sample', () => {
    const r = parse({ weights: '1400 1410 1395 1405 1398 1402' });
    expect(r.success).toBe(true);
  });

  it('rejects a single bird — one bird is not a sample', () => {
    const r = parse({ weights: '1400' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toMatch(/not a sample/);
    }
  });

  it('rejects an entry with nothing in it at all', () => {
    const r = parse({});
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toMatch(/individual weights, or an average/);
    }
  });

  describe('average-only entry, for figures tallied on paper', () => {
    it('accepts an average with a sample size', () => {
      expect(parse({ averageGrams: '1402', sampleSize: '50' }).success).toBe(true);
    });

    it('requires the sample size alongside the average', () => {
      const r = parse({ averageGrams: '1402' });
      expect(r.success).toBe(false);
      if (!r.success) expect(JSON.stringify(r.error.issues)).toMatch(/How many birds/);
    });

    it('rejects an implausible average', () => {
      expect(parse({ averageGrams: '99999', sampleSize: '50' }).success).toBe(false);
      expect(parse({ averageGrams: '2', sampleSize: '50' }).success).toBe(false);
    });
  });

  it('rejects a future date', () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(
      weightSampleSchema.safeParse({ takenOn: tomorrow, weights: '1400 1410' }).success,
    ).toBe(false);
  });

  it('accepts a past date, for catching up on paper records', () => {
    const lastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    expect(
      weightSampleSchema.safeParse({ takenOn: lastWeek, weights: '1400 1410' }).success,
    ).toBe(true);
  });
});
