import { describe, it, expect } from 'vitest';
import { productionGradeSchema, gradeKeyFrom } from '../validation/production';

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
