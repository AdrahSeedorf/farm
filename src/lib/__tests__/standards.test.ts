import { describe, it, expect } from 'vitest';
import { parseStandardTable, toStandardMap } from '../standards';

describe('parsing a breed standard table', () => {
  it('reads a plain days-and-grams table', () => {
    const r = parseStandardTable(`ageDays,grams
0,40
7,70
14,115`);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { ageDays: 0, grams: 40 },
      { ageDays: 7, grams: 70 },
      { ageDays: 14, grams: 115 },
    ]);
  });

  it('reads a WEEKS column and converts, because guides publish weekly', () => {
    const r = parseStandardTable(`week,grams
1,70
2,115
16,1290`);
    expect(r.rows).toEqual([
      { ageDays: 7, grams: 70 },
      { ageDays: 14, grams: 115 },
      { ageDays: 112, grams: 1290 },
    ]);
    expect(r.warnings.join(' ')).toMatch(/WEEKS/);
  });

  it('accepts tabs, semicolons and untidy headers', () => {
    const r = parseStandardTable(`Age (days)\tBody Weight (g)
0\t40
7\t70`);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
  });

  it('ignores blank lines and comments', () => {
    const r = parseStandardTable(`# Isa Brown, 2026 guide
ageDays,grams

0,40

7,70`);
    expect(r.rows).toHaveLength(2);
  });

  it('sorts by age regardless of input order', () => {
    const r = parseStandardTable(`ageDays,grams
14,115
0,40
7,70`);
    expect(r.rows.map((x) => x.ageDays)).toEqual([0, 7, 14]);
  });

  describe('refusing to guess', () => {
    it('names the line it cannot read rather than skipping quietly', () => {
      const r = parseStandardTable(`ageDays,grams
0,40
7,about seventy
14,115`);
      expect(r.errors.join(' ')).toMatch(/Line 3/);
      expect(r.rows).toHaveLength(2);
    });

    it('rejects a table with no recognisable age column', () => {
      const r = parseStandardTable(`bird,grams
0,40`);
      expect(r.errors.join(' ')).toMatch(/No age column/);
      expect(r.rows).toEqual([]);
    });

    it('rejects a table with no weight column', () => {
      const r = parseStandardTable(`ageDays,height
0,40`);
      expect(r.errors.join(' ')).toMatch(/No weight column/);
    });

    it('rejects something that is not a table at all', () => {
      expect(parseStandardTable('ageDays,grams').errors.join(' ')).toMatch(/at least one row/);
    });
  });

  describe('catching likely mistakes', () => {
    it('warns when weight falls with age — a pullet does not lose weight', () => {
      const r = parseStandardTable(`ageDays,grams
7,70
14,115
21,95`);
      expect(r.warnings.join(' ')).toMatch(/falls from 115 g at day 14 to 95 g at day 21/);
      // Warned, not rejected — the farm decides.
      expect(r.rows).toHaveLength(3);
    });

    it('warns about a duplicated age and keeps the later figure', () => {
      const r = parseStandardTable(`ageDays,grams
7,70
7,72`);
      expect(r.warnings.join(' ')).toMatch(/Day 7 appears more than once/);
      expect(r.rows).toEqual([{ ageDays: 7, grams: 72 }]);
    });

    it('warns when the table starts late, so early samples get no target', () => {
      const r = parseStandardTable(`ageDays,grams
35,320
42,400`);
      expect(r.warnings.join(' ')).toMatch(/starts at day 35/);
    });
  });

  it('shapes rows for storage as strings keyed by age', () => {
    expect(toStandardMap([{ ageDays: 7, grams: 70 }])).toEqual({ '7': 70 });
  });
});
