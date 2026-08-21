import { describe, it, expect } from 'vitest';
import {
  fromCedis,
  toCedis,
  parseCedis,
  add,
  subtract,
  multiply,
  divide,
  allocate,
  allocateByWeights,
  formatGHS,
  pesewas,
} from '../money';

describe('money — integer pesewas', () => {
  it('converts cedis to pesewas exactly', () => {
    expect(fromCedis(12.5)).toBe(1250);
    expect(fromCedis(0.01)).toBe(1);
    expect(fromCedis(0)).toBe(0);
  });

  it('survives the float arithmetic that breaks naive money handling', () => {
    // 0.1 + 0.2 !== 0.3 in floating point. In pesewas it is exact.
    expect(add(fromCedis(0.1), fromCedis(0.2))).toBe(fromCedis(0.3));
    // 0.1 * 3 !== 0.30000000000000004 here
    expect(multiply(fromCedis(0.1), 3)).toBe(30);
  });

  it('rounds half away from zero, symmetrically for negatives', () => {
    expect(fromCedis(0.005)).toBe(1);
    expect(fromCedis(-0.005)).toBe(-1);
    expect(multiply(pesewas(5), 0.5)).toBe(3);
    expect(multiply(pesewas(-5), 0.5)).toBe(-3);
  });

  it('rejects non-integer pesewa amounts rather than silently truncating', () => {
    expect(() => pesewas(10.5)).toThrow(/whole number of pesewas/);
    expect(() => pesewas(NaN)).toThrow(/finite/);
  });

  it('parses the ways a person actually types money', () => {
    expect(parseCedis('12.50')).toBe(1250);
    expect(parseCedis('GHS 12.50')).toBe(1250);
    expect(parseCedis('1,250')).toBe(125000);
    expect(parseCedis('')).toBeNull();
    expect(parseCedis('abc')).toBeNull();
  });

  it('adds, subtracts and divides', () => {
    expect(add(pesewas(100), pesewas(250), pesewas(1))).toBe(351);
    expect(subtract(pesewas(500), pesewas(150))).toBe(350);
    expect(divide(pesewas(1000), 3)).toBe(333);
    expect(divide(pesewas(1000), 0)).toBeNull();
  });

  describe('allocate — splitting without losing pesewas', () => {
    it('distributes the remainder and always sums to the original', () => {
      const parts = allocate(pesewas(1000), 3);
      expect(parts).toEqual([334, 333, 333]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    });

    it('never loses a pesewa across many awkward splits', () => {
      for (const total of [1, 7, 99, 100, 1234, 99999]) {
        for (const parts of [2, 3, 7, 11, 13]) {
          const split = allocate(pesewas(total), parts);
          expect(split.reduce((a, b) => a + b, 0)).toBe(total);
          expect(split).toHaveLength(parts);
        }
      }
    });

    it('handles negative amounts (a refund split) without drift', () => {
      const parts = allocate(pesewas(-1000), 3);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(-1000);
    });
  });

  describe('allocateByWeights — apportioning shared farm costs', () => {
    it('splits a feed delivery across flocks by bird-days, exactly', () => {
      // GHS 1,000.00 of feed across three flocks of very different sizes
      const parts = allocateByWeights(fromCedis(1000), [2000, 1500, 500]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(fromCedis(1000));
      expect(parts[0]).toBeGreaterThan(parts[1]);
      expect(parts[1]).toBeGreaterThan(parts[2]);
    });

    it('falls back to an even split when all weights are zero', () => {
      const parts = allocateByWeights(pesewas(100), [0, 0, 0]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    });

    it('sums exactly across many random weightings', () => {
      const amount = pesewas(123457);
      const weights = [3, 17, 5, 41, 2, 88];
      const parts = allocateByWeights(amount, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(amount);
    });
  });

  it('formats for display in GHS', () => {
    expect(formatGHS(fromCedis(1250))).toBe('GHS 1,250.00');
    expect(formatGHS(fromCedis(0))).toBe('GHS 0.00');
    expect(formatGHS(fromCedis(1250), { showSymbol: false })).toBe('1,250.00');
  });

  it('round-trips through cedis for display', () => {
    expect(toCedis(fromCedis(12.34))).toBe(12.34);
  });
});
