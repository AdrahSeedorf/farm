import { describe, it, expect } from 'vitest';
import {
  toBase,
  fromBase,
  convert,
  formatQuantity,
  splitIntoContainers,
  getUnit,
  UomError,
  SEED_UNITS,
} from '../uom';

describe('units of measure', () => {
  it('knows a crate is 30 eggs', () => {
    expect(toBase(1, 'crate')).toBe(30);
    expect(toBase(57, 'crate')).toBe(1710);
  });

  it('knows a feed bag is 50 kg', () => {
    expect(toBase(4, 'bag_50kg')).toBe(200);
    expect(fromBase(200, 'bag_50kg')).toBe(4);
  });

  it('converts within a dimension', () => {
    expect(convert(1, 'box', 'crate')).toBe(12);
    expect(convert(1, 'tonne', 'kg')).toBe(1000);
    expect(convert(2, 'crate', 'dozen')).toBe(5);
    expect(convert(1000, 'g', 'kg')).toBe(1);
  });

  it('REFUSES to convert across dimensions', () => {
    // "How many kilograms is a crate" has no answer, and guessing one is how
    // bad data enters a farm system.
    expect(() => convert(1, 'crate', 'kg')).toThrow(UomError);
    expect(() => convert(1, 'kg', 'litre')).toThrow(/different things/);
  });

  it('rejects unknown units instead of assuming a default', () => {
    expect(() => getUnit('barrel')).toThrow(/Unknown unit/);
  });

  it('formats quantities with their symbol', () => {
    expect(formatQuantity(1710, 'piece', 'crate')).toBe('57 crate');
    expect(formatQuantity(200, 'kg', 'bag_50kg')).toBe('4 bag');
    expect(formatQuantity(1712, 'piece', 'crate')).toBe('57.07 crate');
  });

  it('splits a day of eggs into crates and loose eggs, the way people talk', () => {
    expect(splitIntoContainers(1712, 'crate')).toEqual({ containers: 57, remainder: 2 });
    expect(splitIntoContainers(30, 'crate')).toEqual({ containers: 1, remainder: 0 });
    expect(splitIntoContainers(29, 'crate')).toEqual({ containers: 0, remainder: 29 });
  });

  it('has exactly one base unit per dimension', () => {
    for (const dimension of ['COUNT', 'MASS', 'VOLUME'] as const) {
      const bases = SEED_UNITS.filter((u) => u.dimension === dimension && u.isBase);
      expect(bases).toHaveLength(1);
      expect(bases[0].factorToBase).toBe(1);
    }
  });

  it('round-trips every seed unit through its base without drift', () => {
    for (const unit of SEED_UNITS) {
      const back = fromBase(toBase(7, unit.key), unit.key);
      expect(back).toBeCloseTo(7, 10);
    }
  });
});
