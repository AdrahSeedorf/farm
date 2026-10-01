import { describe, expect, it } from 'vitest';
import {
  VARIANCE_CAUSES,
  adjustmentNote,
  causeLabel,
  causesFor,
  countErrors,
  countSummary,
  countWarnings,
  countedLines,
  discrepancies,
  isValidCause,
  lastCountedSentence,
  lineSentence,
  referenceFor,
  sequenceOf,
  totalVariance,
  varianceOf,
  variancePct,
  say,
  type CountLine,
} from '@/lib/stock-take';

const line = (over: Partial<CountLine> = {}): CountLine => ({
  itemId: 'itm-1',
  itemName: 'Eggs — large',
  unitKey: 'piece',
  expectedBase: 100,
  countedBase: 100,
  ...over,
});

const TODAY = new Date('2026-10-01T00:00:00Z');

describe('varianceOf', () => {
  it('is counted minus expected, so short is negative', () => {
    expect(varianceOf(line({ countedBase: 94 }))).toBe(-6);
  });

  it('is positive when there is more on the shelf than the records knew', () => {
    expect(varianceOf(line({ countedBase: 112 }))).toBe(12);
  });

  it('is null for a line nobody counted — not zero', () => {
    // Zero would read as "counted, and it agreed", which is a different and
    // much stronger claim than "nobody looked".
    expect(varianceOf(line({ countedBase: null }))).toBeNull();
  });

  it('does not accumulate float error on fractional stock', () => {
    expect(varianceOf(line({ expectedBase: 0.3, countedBase: 0.1 }))).toBe(-0.2);
  });
});

describe('counted and uncounted lines', () => {
  it('separates what was counted from what was skipped', () => {
    const lines = [line(), line({ itemId: 'itm-2', countedBase: null })];
    expect(countedLines(lines)).toHaveLength(1);
  });

  it('treats a counted zero as counted', () => {
    // An empty shelf is a finding, not an absence of one.
    expect(countedLines([line({ expectedBase: 40, countedBase: 0 })])).toHaveLength(1);
  });

  it('reports only the lines that actually disagree', () => {
    const lines = [line(), line({ itemId: 'itm-2', countedBase: 80 })];
    expect(discrepancies(lines).map((l) => l.itemId)).toEqual(['itm-2']);
  });

  it('never counts an uncounted line as a discrepancy', () => {
    expect(discrepancies([line({ countedBase: null, expectedBase: 500 })])).toEqual([]);
  });
});

describe('totalVariance', () => {
  it('lets a short and an over cancel, because that is what the ledger does', () => {
    const lines = [line({ countedBase: 90 }), line({ itemId: 'itm-2', countedBase: 110 })];
    expect(totalVariance(lines)).toBe(0);
  });

  it('is zero when nothing was counted', () => {
    expect(totalVariance([line({ countedBase: null })])).toBe(0);
  });
});

describe('variancePct', () => {
  it('scales the gap against what was expected', () => {
    expect(variancePct(line({ expectedBase: 200, countedBase: 180 }))).toBe(-10);
  });

  it('is null where the records expected nothing', () => {
    // Twelve of something the ledger never heard of is not "infinitely wrong".
    expect(variancePct(line({ expectedBase: 0, countedBase: 12 }))).toBeNull();
  });
});

describe('variance causes', () => {
  it('offers breakage for a shortage and not for a surplus', () => {
    expect(causesFor(-5).map((c) => c.key)).toContain('breakage');
    expect(causesFor(5).map((c) => c.key)).not.toContain('breakage');
  });

  it('offers an unrecorded receipt for a surplus and not for a shortage', () => {
    expect(causesFor(5).map((c) => c.key)).toContain('unrecorded_receipt');
    expect(causesFor(-5).map((c) => c.key)).not.toContain('unrecorded_receipt');
  });

  it('offers "nobody knows" in both directions, always', () => {
    expect(causesFor(-5).map((c) => c.key)).toContain('unknown');
    expect(causesFor(5).map((c) => c.key)).toContain('unknown');
  });

  it('puts "nobody knows" first, so the honest answer is the easy one', () => {
    expect(causesFor(-5)[0].key).toBe('unknown');
  });

  it('rejects a cause that cannot explain the direction', () => {
    expect(isValidCause('breakage', 5)).toBe(false);
    expect(isValidCause('breakage', -5)).toBe(true);
  });

  it('rejects an invented key', () => {
    expect(isValidCause('rats_probably', -5)).toBe(false);
  });

  it('every cause has a label and a direction', () => {
    for (const cause of VARIANCE_CAUSES) {
      expect(cause.label.length).toBeGreaterThan(0);
      expect(['SHORT', 'OVER', 'BOTH']).toContain(cause.appliesTo);
    }
  });

  it('falls back to the raw key rather than blanking an unknown label', () => {
    expect(causeLabel('retired_code')).toBe('retired_code');
    expect(causeLabel(null)).toBeNull();
  });
});

describe('countErrors', () => {
  const ok = { lines: [line()], countedOn: TODAY, today: TODAY };

  it('accepts a count that agrees with the records', () => {
    expect(countErrors(ok)).toEqual([]);
  });

  it('refuses a take where nothing was counted at all', () => {
    expect(
      countErrors({ ...ok, lines: [line({ countedBase: null })] }).join(' '),
    ).toMatch(/Nothing has been counted/);
  });

  it('refuses a negative count', () => {
    expect(countErrors({ ...ok, lines: [line({ countedBase: -1 })] }).join(' ')).toMatch(
      /cannot be negative/,
    );
  });

  it('refuses a count dated in the future', () => {
    expect(
      countErrors({ ...ok, countedOn: new Date('2026-10-02T00:00:00Z') }).join(' '),
    ).toMatch(/cannot happen in the future/);
  });

  it('refuses a count older than a month, which no longer describes the shelf', () => {
    expect(
      countErrors({ ...ok, countedOn: new Date('2026-08-01T00:00:00Z') }).join(' '),
    ).toMatch(/more than a month ago/);
  });

  it('accepts a count from yesterday', () => {
    expect(countErrors({ ...ok, countedOn: new Date('2026-09-30T00:00:00Z') })).toEqual([]);
  });

  it('refuses a variance with no reason given', () => {
    const errors = countErrors({ ...ok, lines: [line({ countedBase: 94 })] });
    expect(errors.join(' ')).toMatch(/Say why before saving/);
  });

  it('accepts a variance explained as "nobody knows"', () => {
    expect(
      countErrors({ ...ok, lines: [line({ countedBase: 94, cause: 'unknown' })] }),
    ).toEqual([]);
  });

  it('refuses a reason that cannot explain the direction', () => {
    expect(
      countErrors({
        ...ok,
        lines: [line({ countedBase: 112, cause: 'breakage' })],
      }).join(' '),
    ).toMatch(/does not explain/);
  });

  it('does not demand a reason from a line that agreed', () => {
    expect(countErrors({ ...ok, lines: [line({ cause: null })] })).toEqual([]);
  });
});

describe('countWarnings', () => {
  it('says nothing when the shelf and the records agree', () => {
    expect(countWarnings([line()])).toEqual([]);
  });

  it('stays quiet about a small difference', () => {
    expect(countWarnings([line({ expectedBase: 1000, countedBase: 995 })])).toEqual([]);
  });

  it('warns on a difference of a tenth or more', () => {
    const warnings = countWarnings([line({ expectedBase: 100, countedBase: 80 })]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/20% out/);
  });

  it('names the direction in words rather than a sign', () => {
    expect(countWarnings([line({ expectedBase: 100, countedBase: 80 })])[0].message).toMatch(
      /fewer/,
    );
    expect(countWarnings([line({ expectedBase: 100, countedBase: 130 })])[0].message).toMatch(
      /more/,
    );
  });

  it('warns specially where the records held nothing at all', () => {
    const warnings = countWarnings([line({ expectedBase: 0, countedBase: 12 })]);
    expect(warnings[0].message).toMatch(/no Eggs — large at all/);
  });

  it('warns on suspected theft, because it is permanent', () => {
    const warnings = countWarnings([line({ countedBase: 94, cause: 'suspected_theft' })]);
    expect(warnings[0].message).toMatch(/cannot be edited or removed/);
  });

  it('never refuses — a warning is all it is', () => {
    // The shelf is the shelf. Refusing a surprising count does not change what
    // is in the store, it only means nobody knows.
    const surprising = { lines: [line({ countedBase: 1, cause: 'unknown' })], countedOn: TODAY, today: TODAY };
    expect(countWarnings(surprising.lines)).not.toEqual([]);
    expect(countErrors(surprising)).toEqual([]);
  });
});

/**
 * THE BUG THE BROWSER FOUND, kept as tests.
 *
 * A storekeeper counted four bags of feed instead of five and was told "50 fewer
 * Layer mash than the records say". Fifty of anything is a disaster; one bag is a
 * Tuesday. The arithmetic was right and the sentence was wrong, which is the
 * worst combination — nothing fails, and the person acts on it.
 */
describe('speaking in the unit somebody counted in', () => {
  const bags = (over: Partial<CountLine> = {}): CountLine =>
    line({ display: { unitName: 'Bag (50 kg)', factorToBase: 50 }, ...over });

  it('says one bag, not fifty kilograms', () => {
    const warnings = countWarnings([bags({ expectedBase: 250, countedBase: 200 })]);
    expect(warnings[0].message).toMatch(/1 Bag \(50 kg\) fewer/);
    expect(warnings[0].message).not.toMatch(/50 Bag/);
  });

  it('asks for a reason in bags too', () => {
    const problems = countErrors({
      lines: [bags({ expectedBase: 250, countedBase: 200 })],
      countedOn: TODAY,
      today: TODAY,
    });
    expect(problems[0]).toMatch(/out by 1 Bag \(50 kg\)/);
  });

  it('writes the ledger note in bags, since a person reads it', () => {
    const note = adjustmentNote(
      'ST-2026-0003',
      bags({ expectedBase: 250, countedBase: 200, cause: 'breakage' }),
    );
    expect(note).toMatch(/counted 4 Bag \(50 kg\)/);
    expect(note).toMatch(/records said 5 Bag \(50 kg\)/);
  });

  it('keeps fractions rather than rounding a part-bag away', () => {
    expect(say(bags(), 75)).toBe('1.5 Bag (50 kg)');
  });

  it('falls back to a bare number rather than inventing a unit name', () => {
    // A count line with no unit is terse. One with a guessed unit is wrong.
    expect(say(line(), 42)).toBe('42');
  });

  it('leaves a piece-counted item alone, where base and display are the same', () => {
    const pieces = line({
      expectedBase: 100,
      countedBase: 80,
      display: { unitName: 'Piece', factorToBase: 1 },
    });
    expect(countWarnings([pieces])[0]?.message ?? '').toMatch(/20 Piece fewer/);
  });
});

describe('sentences', () => {
  it('says a line agreed without claiming the system was right', () => {
    expect(lineSentence(line())).toBe('Eggs — large — 100 counted, and the records agreed.');
  });

  it('says how far out a line was, in plain words', () => {
    expect(lineSentence(line({ countedBase: 94 }))).toMatch(/6 fewer than the records said/);
  });

  it('says plainly when a line was skipped', () => {
    expect(lineSentence(line({ countedBase: null }))).toMatch(/not counted/);
  });

  it('summarises a clean count as agreement, not as correctness', () => {
    expect(countSummary([line(), line({ itemId: 'itm-2' })])).toMatch(
      /the store agreed with the records/,
    );
  });

  it('summarises shorts and overs separately', () => {
    const summary = countSummary([
      line({ countedBase: 90, cause: 'unknown' }),
      line({ itemId: 'itm-2', countedBase: 110, cause: 'unknown' }),
    ]);
    expect(summary).toMatch(/1 short/);
    expect(summary).toMatch(/1 over/);
  });

  it('says nothing was counted rather than returning an empty string', () => {
    expect(countSummary([])).toBe('Nothing counted.');
  });

  it('writes the whole story onto the ledger note', () => {
    const note = adjustmentNote('ST-2026-0007', line({ countedBase: 94, cause: 'breakage' }));
    expect(note).toMatch(/ST-2026-0007/);
    expect(note).toMatch(/counted 94/);
    expect(note).toMatch(/records said 100/);
    expect(note).toMatch(/\(-6\)/);
    expect(note).toMatch(/Broken or spoiled/);
  });

  it('signs a surplus explicitly so it cannot be misread', () => {
    expect(adjustmentNote('ST-2026-0007', line({ countedBase: 112 }))).toMatch(/\(\+12\)/);
  });
});

describe('references', () => {
  it('pads to four digits', () => {
    expect(referenceFor(2026, 7)).toBe('ST-2026-0007');
  });

  it('does not truncate past four digits', () => {
    expect(referenceFor(2026, 12345)).toBe('ST-2026-12345');
  });

  it('round-trips', () => {
    expect(sequenceOf(referenceFor(2026, 42), 2026)).toBe(42);
  });

  it('ignores a reference from another year', () => {
    expect(sequenceOf('ST-2025-0042', 2026)).toBe(0);
  });
});

describe('lastCountedSentence', () => {
  it('says plainly when a store has never been counted', () => {
    expect(lastCountedSentence(null, TODAY)).toBe('This store has never been counted.');
  });

  it('says today, yesterday, and a number of days', () => {
    expect(lastCountedSentence(TODAY, TODAY)).toBe('Counted today.');
    expect(lastCountedSentence(new Date('2026-09-30T00:00:00Z'), TODAY)).toBe('Counted yesterday.');
    expect(lastCountedSentence(new Date('2026-09-20T00:00:00Z'), TODAY)).toBe('Counted 11 days ago.');
  });

  it('gives the date once it is old enough that a day count stops meaning anything', () => {
    expect(lastCountedSentence(new Date('2026-01-04T00:00:00Z'), TODAY)).toMatch(
      /2026-01-04 — over two months ago/,
    );
  });
});
