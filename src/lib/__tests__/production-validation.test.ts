import { describe, it, expect } from 'vitest';
import {
  productionGradeSchema,
  gradeKeyFrom,
  collectionSchema,
  countedToBase,
  parseGradeLines,
} from '../validation/production';

/** What the form actually posts: strings, every one of them. */
const form = (overrides: Record<string, string> = {}) => ({
  name: 'Extra large',
  isSaleable: 'true',
  minGrams: '',
  maxGrams: '',
  ...overrides,
});

describe('a grade as the form submits it', () => {
  it('parses a name and the saleable choice', () => {
    const parsed = productionGradeSchema.parse(form());
    expect(parsed.name).toBe('Extra large');
    expect(parsed.isSaleable).toBe(true);
  });

  it('turns the dropdown’s string into a real boolean', () => {
    expect(productionGradeSchema.parse(form({ isSaleable: 'false' })).isSaleable).toBe(false);
  });

  it('refuses a saleable value that came from neither option', () => {
    // A hand-crafted POST, or a checkbox someone reintroduced. Either way the
    // answer is not guessed — "on" is not a decision about food safety.
    expect(productionGradeSchema.safeParse(form({ isSaleable: 'on' })).success).toBe(false);
  });

  it('needs a name worth showing on a screen', () => {
    expect(productionGradeSchema.safeParse(form({ name: 'X' })).success).toBe(false);
  });
});

describe('the weight band', () => {
  it('is nothing when nobody has set one — not zero', () => {
    const parsed = productionGradeSchema.parse(form());
    expect(parsed.minGrams).toBeNull();
    expect(parsed.maxGrams).toBeNull();
  });

  it('takes whole grams', () => {
    const parsed = productionGradeSchema.parse(form({ minGrams: '63', maxGrams: '73' }));
    expect(parsed.minGrams).toBe(63);
    expect(parsed.maxGrams).toBe(73);
  });

  it('accepts a band open at one end', () => {
    expect(productionGradeSchema.parse(form({ minGrams: '73' })).maxGrams).toBeNull();
  });

  it('REFUSES A BAND THAT DESCRIBES NOTHING', () => {
    // Configuration, not an observation. An egg heavier than 73 g and lighter
    // than 63 g does not exist, and the band would silently match nothing.
    const result = productionGradeSchema.safeParse(form({ minGrams: '73', maxGrams: '63' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['maxGrams']);
    }
  });

  it('refuses a figure that is not a whole number of grams', () => {
    expect(productionGradeSchema.safeParse(form({ minGrams: '62.5' })).success).toBe(false);
    expect(productionGradeSchema.safeParse(form({ minGrams: 'big' })).success).toBe(false);
    expect(productionGradeSchema.safeParse(form({ minGrams: '0' })).success).toBe(false);
  });
});

describe('the key derived from a name', () => {
  it('is stable, lower case and safe to put in a file', () => {
    expect(gradeKeyFrom('Extra large')).toBe('extra_large');
    expect(gradeKeyFrom('Grade A+')).toBe('grade_a');
    expect(gradeKeyFrom('  Floor egg  ')).toBe('floor_egg');
  });

  it('matches the keys the seed writes, so a farm and the seed agree', () => {
    expect(gradeKeyFrom('Cracked')).toBe('cracked');
    expect(gradeKeyFrom('Pullet')).toBe('pullet');
  });

  it('is empty when a name carries nothing usable, so the caller can refuse it', () => {
    expect(gradeKeyFrom('+++')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// ONE COLLECTION
// ---------------------------------------------------------------------------

const collectionForm = (overrides: Record<string, string> = {}) => ({
  onDate: '2026-06-01',
  counted: '820',
  unit: 'piece',
  disposition: 'SALEABLE',
  dispositionNote: '',
  notes: '',
  idempotencyKey: 'a0b1c2d3e4f5',
  acknowledgedToken: '',
  ...overrides,
});

describe('a collection as the form submits it', () => {
  it('parses the date, the count and the disposition', () => {
    const parsed = collectionSchema.parse(collectionForm());
    expect(parsed.counted).toBe(820);
    expect(parsed.disposition).toBe('SALEABLE');
    expect(parsed.onDate.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('treats a blank count as NOT COUNTED rather than as none collected', () => {
    // The trap validation/daily.ts names: `Number("")` is 0, and a collection
    // nobody counted would otherwise be recorded as a collection of nothing.
    expect(collectionSchema.parse(collectionForm({ counted: '' })).counted).toBeNull();
  });

  it('keeps a genuine zero as a zero', () => {
    expect(collectionSchema.parse(collectionForm({ counted: '0' })).counted).toBe(0);
  });

  it('refuses a date in the future, whatever the date picker allowed', () => {
    const nextYear = `${new Date().getUTCFullYear() + 1}-01-01`;
    expect(collectionSchema.safeParse(collectionForm({ onDate: nextYear })).success).toBe(false);
  });

  it('refuses a unit that is not something eggs are counted in', () => {
    expect(collectionSchema.safeParse(collectionForm({ unit: 'kg' })).success).toBe(false);
  });

  it('refuses a disposition that is not one of the four', () => {
    expect(collectionSchema.safeParse(collectionForm({ disposition: 'SOLD' })).success).toBe(false);
  });

  it('needs an idempotency key, because a retrying phone must not double-count', () => {
    expect(collectionSchema.safeParse(collectionForm({ idempotencyKey: '' })).success).toBe(false);
  });
});

describe('the counted figure in whatever unit it was taken in', () => {
  it('is already in eggs when eggs is what was counted', () => {
    expect(countedToBase(820, 'piece')).toEqual({ base: 820 });
  });

  it('turns crates into eggs at thirty, which lives in uom.ts as data', () => {
    expect(countedToBase(12, 'crate')).toEqual({ base: 360 });
    expect(countedToBase(30, 'dozen')).toEqual({ base: 360 });
  });

  it('survives binary floating point on a fractional crate', () => {
    // 12.1 x 30 evaluates to 363.00000000000006. It is 363 eggs.
    expect(countedToBase(12.1, 'crate')).toEqual({ base: 363 });
  });

  it('REFUSES A FRACTION OF AN EGG, and says what to type instead', () => {
    const result = countedToBase(12.17, 'crate');
    expect(result.base).toBeNull();
    expect(result.error).toMatch(/not a whole number/i);
    expect(result.error).toMatch(/in pieces instead/i);
  });

  it('is nothing at all when nothing was counted', () => {
    expect(countedToBase(null, 'crate')).toEqual({ base: null });
  });
});

describe('the per-grade boxes', () => {
  const form = (entries: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(entries)) data.append(k, v);
    return data;
  };

  it('reads only the grades currently offered', () => {
    const { lines } = parseGradeLines(
      form({ grade_a: '600', grade_b: '200', grade_retired: '999' }),
      ['a', 'b'],
      'piece',
    );
    expect(lines).toEqual([
      { gradeId: 'a', quantityBase: 600, entered: 600 },
      { gradeId: 'b', quantityBase: 200, entered: 200 },
    ]);
  });

  it('IGNORES A GRADE NOBODY WAS OFFERED, rather than trusting the post', () => {
    const { lines } = parseGradeLines(
      form({ grade_from_another_farm: '5000' }),
      ['a'],
      'piece',
    );
    expect(lines).toEqual([]);
  });

  it('converts every box with the one unit the form was filled in', () => {
    const { lines } = parseGradeLines(form({ grade_a: '20', grade_b: '4' }), ['a', 'b'], 'crate');
    expect(lines.map((l) => l.quantityBase)).toEqual([600, 120]);
    // What was typed is kept as typed, so "20 crates" stays legible as 20.
    expect(lines.map((l) => l.entered)).toEqual([20, 4]);
  });

  it('leaves out a blank box and a zero, which record nothing', () => {
    const { lines } = parseGradeLines(
      form({ grade_a: '', grade_b: '0', grade_c: '15' }),
      ['a', 'b', 'c'],
      'piece',
    );
    expect(lines).toEqual([{ gradeId: 'c', quantityBase: 15, entered: 15 }]);
  });

  it('names the field when a figure cannot be a whole number of eggs', () => {
    const { lines, fieldErrors } = parseGradeLines(form({ grade_a: '1.1' }), ['a'], 'dozen');
    expect(lines).toEqual([]);
    expect(fieldErrors.grade_a).toMatch(/13.2 — not a whole number/);
  });

  it('names the field when a figure is not a number at all', () => {
    const { fieldErrors } = parseGradeLines(form({ grade_a: 'plenty' }), ['a'], 'piece');
    expect(fieldErrors.grade_a).toMatch(/Enter a number/i);
  });
});
