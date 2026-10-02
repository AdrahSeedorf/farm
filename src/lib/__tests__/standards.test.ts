import { describe, it, expect } from 'vitest';
import {
  parseStandardTable,
  parseLayCurveTable,
  toStandardMap,
  toLayCurveMap,
  detectKind,
  previewOf,
  previewSentence,
  kindLabel,
} from '../standards';

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

describe('parsing a lay curve', () => {
  it('reads a weeks-and-percentage table, as guides publish it', () => {
    const r = parseLayCurveTable(`week,henDayPct
20,28.5
21,58
22,80.4`);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { ageDays: 140, pct: 28.5 },
      { ageDays: 147, pct: 58 },
      { ageDays: 154, pct: 80.4 },
    ]);
  });

  it('keeps one decimal, because rounding 90.4 to 90 moves every target', () => {
    const r = parseLayCurveTable(`week,laying rate
28,94.36`);
    expect(r.rows[0].pct).toBe(94.4);
  });

  it('accepts the several names guides give the same column', () => {
    for (const header of ['henDayPct', 'Lay %', 'Laying rate', 'Production (%)', 'hen-day', '%']) {
      const r = parseLayCurveTable(`week,${header}\n20,28.5`);
      expect(r.errors, header).toEqual([]);
    }
  });

  it('reads a figure written with its percent sign', () => {
    expect(parseLayCurveTable(`week,lay\n20,28.5%`).rows[0].pct).toBe(28.5);
  });

  it('REFUSES A FIGURE ABOVE 100 — a hen lays at most one egg a day', () => {
    const r = parseLayCurveTable(`week,henDayPct
20,28.5
21,580`);
    expect(r.errors.join(' ')).toMatch(/Line 3/);
    expect(r.errors.join(' ')).toMatch(/at most one egg a day/);
    expect(r.rows).toHaveLength(1);
  });

  it('accepts a zero, because a curve may start before the first egg', () => {
    expect(parseLayCurveTable(`week,lay\n18,0\n19,5`).errors).toEqual([]);
  });

  it('DOES NOT WARN WHEN THE CURVE FALLS — a lay curve is supposed to', () => {
    // The weight parser warns about exactly this shape. A flock peaks around
    // week 28 and declines for the rest of the cycle; warning here would fire on
    // every correct table there is.
    const r = parseLayCurveTable(`week,henDayPct
28,94
40,90
60,82`);
    expect(r.warnings.join(' ')).not.toMatch(/falls/);
  });

  it('warns when the table looks like fractions rather than percentages', () => {
    const r = parseLayCurveTable(`week,lay
20,0.28
21,0.58
22,0.80`);
    expect(r.warnings.join(' ')).toMatch(/fractions \(0.9\) rather than percentages/);
    // Warned, not refused — the farm decides.
    expect(r.rows).toHaveLength(3);
  });

  it('rejects a table with no production column', () => {
    expect(parseLayCurveTable(`week,grams\n20,1500`).errors.join(' ')).toMatch(
      /No production column/,
    );
  });

  it('shapes rows for storage as strings keyed by age', () => {
    expect(toLayCurveMap([{ ageDays: 154, pct: 80.4 }])).toEqual({ '154': 80.4 });
  });
});

describe('telling the two tables apart', () => {
  it('reads a weight table off its header', () => {
    expect(detectKind('week,grams\n1,70')).toBe('weight');
  });

  it('reads a lay curve off its header', () => {
    expect(detectKind('week,henDayPct\n20,28.5')).toBe('lay');
  });

  it('looks past comments and blank lines to the real header', () => {
    expect(detectKind('# ISA Brown, 2026 guide\n\nweek,laying rate\n20,28.5')).toBe('lay');
  });

  it('says nothing rather than guessing when the header names neither', () => {
    // The loader then refuses and asks, rather than writing a lay curve into the
    // weight column where it would look plausible and be nonsense.
    expect(detectKind('week,height\n1,70')).toBeNull();
    expect(detectKind('')).toBeNull();
  });
});

/**
 * THE CONFIRMATION STEP.
 *
 * The two tables are indistinguishable at a glance — both are two columns of
 * numbers out of a management guide. A lay curve written into the weight column
 * gives a target of 28 grams at week 20: a plausible number, entirely wrong, and
 * nothing downstream can catch it, because 28 is a number. So the kind is
 * detected, said out loud and agreed to before anything is written.
 */
describe('showing somebody what they pasted', () => {
  const WEIGHT = 'week,grams\n1,70\n2,115\n18,1450';
  const LAY = 'week,henDayPct\n20,28.5\n30,94.0\n70,78.5';

  it('reads a weight table as a weight table', () => {
    const preview = previewOf(WEIGHT);
    expect(preview.kind).toBe('weight');
    expect(preview.points).toHaveLength(3);
    expect(preview.errors).toEqual([]);
  });

  it('reads a lay curve as a lay curve', () => {
    const preview = previewOf(LAY);
    expect(preview.kind).toBe('lay');
    expect(preview.points.map((p) => p.value)).toEqual([28.5, 94, 78.5]);
  });

  it('REFUSES a table that does not say which kind it is', () => {
    // Rather than guessing. Guessing here is the one mistake that cannot be
    // noticed afterwards.
    const preview = previewOf('week,value\n1,70\n2,115');
    expect(preview.kind).toBeNull();
    expect(preview.points).toEqual([]);
    expect(preview.errors.join(' ')).toMatch(/does not say which kind of table/);
  });

  /**
   * A GUIDE OFTEN PRINTS BOTH COLUMNS IN ONE TABLE. Detection reads the first it
   * recognises, which is the weight column — so the override is what lets the
   * lay curve be taken out of the same paste rather than retyped.
   */
  it('lets the kind be stated by hand when one table holds both columns', () => {
    const both = 'week,grams,henDayPct\n20,1750,28.5\n30,1900,94.0';
    expect(previewOf(both).kind).toBe('weight');
    expect(previewOf(both).points.map((p) => p.value)).toEqual([1750, 1900]);
    expect(previewOf(both, 'lay').points.map((p) => p.value)).toEqual([28.5, 94]);
  });

  it('keeps the parser’s own precise error when a column is missing', () => {
    // "No weight column found. Use a header of grams." is more actionable than
    // anything this layer could add, so it is passed through untouched.
    const preview = previewOf('week,value\n1,70', 'weight');
    expect(preview.points).toEqual([]);
    expect(preview.errors.join(' ')).toMatch(/No weight column found/);
  });

  it('names the kind FIRST in the sentence somebody has to agree to', () => {
    expect(previewSentence(previewOf(LAY))).toMatch(/^Read as a lay curve:/);
    expect(previewSentence(previewOf(WEIGHT))).toMatch(/^Read as a body weight table:/);
  });

  it('states the span in both days and weeks, and in the right unit', () => {
    const sentence = previewSentence(previewOf(WEIGHT));
    expect(sentence).toMatch(/day 7 \(week 1\) → 70 g/);
    expect(sentence).toMatch(/day 126 \(week 18\) → 1450 g/);
    expect(sentence).not.toMatch(/%/);
  });

  it('uses percentages for a lay curve and never grams', () => {
    const sentence = previewSentence(previewOf(LAY));
    expect(sentence).toMatch(/→ 28.5%/);
    expect(sentence).not.toMatch(/ g\b/);
  });

  it('says plainly when nothing could be read, rather than returning an empty string', () => {
    expect(previewSentence(previewOf(''))).toBe('Nothing could be read from that.');
  });

  it('does not collapse a single-point table into a range', () => {
    const sentence = previewSentence(previewOf('week,grams\n18,1450'));
    expect(sentence).toMatch(/1 points/);
    expect(sentence).not.toMatch(/…/);
  });

  it('carries the parser’s own warnings through to the person', () => {
    // A row the parser skipped must not vanish between the paste and the save.
    const preview = previewOf('week,grams\n1,70\nnonsense\n2,115');
    expect(preview.warnings.length).toBeGreaterThan(0);
  });

  it('labels each kind the way a farm would say it', () => {
    expect(kindLabel('weight')).toBe('body weight table');
    expect(kindLabel('lay')).toBe('lay curve');
  });
});
