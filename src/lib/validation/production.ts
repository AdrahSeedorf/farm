import { z } from 'zod';
import { recordDate } from '@/lib/validation/daily';
import { convert, getUnit } from '@/lib/uom';

/**
 * Production validation — ADRAH Farms
 *
 * One schema, used by the form and by the server action. Client-side rules that
 * drift from server-side rules are how a field ends up validated in the browser
 * and unvalidated where it matters.
 *
 * NOTE ON WHAT IS REFUSED HERE. The system warns about unusual OBSERVATIONS and
 * never blocks them — an impossible-looking egg count still saves, because it
 * might be what happened. CONFIGURATION is different: a grade whose minimum
 * weight is above its maximum describes nothing that could exist, and accepting
 * it would only produce a band that silently matches no egg at all.
 */

/** A grams boundary on a grade. Blank means nobody has set one. */
const optionalGrams = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : Number(v)))
  .refine(
    (v) => v === null || (Number.isInteger(v) && v > 0 && v <= 500),
    'Enter a whole number of grams, or leave it blank.',
  );

export const productionGradeSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter a name.').max(40),
    /**
     * Submitted as a string from a <select> rather than a checkbox.
     *
     * React 19 resets a form's DOM after a server action and does NOT restore a
     * checkbox — it snaps back while React state still holds the real choice, so
     * the next submit sends the wrong value. `components/ui/form.tsx` already
     * solves this for Select, and a two-state choice reads better on a phone as
     * a dropdown anyway.
     */
    isSaleable: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true'),
    minGrams: optionalGrams,
    maxGrams: optionalGrams,
  })
  .refine(
    (g) => g.minGrams === null || g.maxGrams === null || g.minGrams < g.maxGrams,
    { path: ['maxGrams'], message: 'The maximum must be above the minimum.' },
  );

export type ProductionGradeInput = z.infer<typeof productionGradeSchema>;

/**
 * A stable key derived from the name, so imports, exports and the seed can all
 * target the same grade. Derived rather than typed: a key people edit is a key
 * that eventually differs from the one in last year's spreadsheet.
 */
export function gradeKeyFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ---------------------------------------------------------------------------
// ONE COLLECTION
// ---------------------------------------------------------------------------

/**
 * The units a collection may be counted in.
 *
 * All COUNT units, so nothing here can turn eggs into kilograms — `uom.convert`
 * throws across dimensions and this list never gives it the chance. A crate is
 * 30 in Ghana and that number lives in `uom.ts` as data, not here.
 */
export const COUNTING_UNITS = ['piece', 'dozen', 'crate'] as const;
export type CountingUnit = (typeof COUNTING_UNITS)[number];

export const DISPOSITIONS = ['SALEABLE', 'HELD', 'DISCARDED', 'HOME_USE'] as const;

export const DISPOSITION_LABELS: Record<(typeof DISPOSITIONS)[number], string> = {
  SALEABLE: 'Fit for sale',
  HELD: 'Held back',
  DISCARDED: 'Destroyed',
  HOME_USE: 'Eaten on the farm',
};

/**
 * A counted quantity as typed. Blank means NOT COUNTED, which is not zero.
 *
 * The same trap `validation/daily.ts` names: `z.coerce.number()` turns "" into
 * 0, so a collection nobody counted would be recorded as a collection of
 * nothing — and a zero drags every production average down for as long as the
 * records exist.
 */
const optionalCount = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : Number(v)))
  .refine(
    (v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 1_000_000),
    'Enter a number, or leave it blank if it was not counted.',
  );

export const collectionSchema = z.object({
  onDate: recordDate,

  /**
   * What was counted in the house, before grading. Optional: a farm that grades
   * as it collects has one set of figures, not two.
   */
  counted: optionalCount,

  /** The unit every figure on this form was typed in. */
  unit: z.enum(COUNTING_UNITS),

  disposition: z.enum(DISPOSITIONS),
  dispositionNote: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),

  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),

  /**
   * Generated when the form is rendered and submitted with it. A phone on a poor
   * connection retries; without this one collection is recorded twice and the
   * day's production is overstated by a third.
   */
  idempotencyKey: z.string().trim().min(8).max(64),

  /** Fingerprint of the warnings the person actually saw. Never a boolean. */
  acknowledgedToken: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
});

export type CollectionInput = z.infer<typeof collectionSchema>;

export interface ParsedGradeLine {
  gradeId: string;
  /** Whole pieces, converted from whatever unit was used. */
  quantityBase: number;
  /** What was typed, in `unit`. */
  entered: number;
}

export interface ParsedGradeLines {
  lines: ParsedGradeLine[];
  fieldErrors: Record<string, string>;
}

/**
 * Read the per-grade boxes off the form.
 *
 * The grade list is configuration, so the fields cannot be named in a static
 * schema — they arrive as `grade_<id>`. Only ids the caller says are currently
 * offered are read: a hand-crafted POST naming a retired grade, or a grade
 * belonging to another farm, is ignored rather than trusted.
 *
 * A COUNT MUST COME OUT AS WHOLE EGGS. "12.17 crates" is 365.1 eggs, which is
 * not a thing anyone collected, and rounding it silently would invent or destroy
 * an egg on every entry. The field is refused with the arithmetic shown, and the
 * person can type the exact figure in eggs instead — nothing observed is lost,
 * which is why this refusal does not break the warn-never-block rule.
 */
export function parseGradeLines(
  formData: FormData,
  offeredGradeIds: string[],
  unit: CountingUnit,
): ParsedGradeLines {
  const lines: ParsedGradeLine[] = [];
  const fieldErrors: Record<string, string> = {};
  const symbol = getUnit(unit).name.toLowerCase();

  for (const gradeId of offeredGradeIds) {
    const field = `grade_${gradeId}`;
    const raw = formData.get(field);
    if (typeof raw !== 'string' || raw.trim() === '') continue;

    const entered = Number(raw.trim());
    if (!Number.isFinite(entered) || entered < 0) {
      fieldErrors[field] = 'Enter a number, or leave it blank.';
      continue;
    }
    if (entered === 0) continue;

    const quantityBase = wholePieces(convert(entered, unit, 'piece'));
    if (quantityBase === null) {
      fieldErrors[field] =
        `${entered} ${symbol} is ${readable(convert(entered, unit, 'piece'))} — not a whole ` +
        `number. Enter the exact figure in pieces instead.`;
      continue;
    }

    lines.push({ gradeId, quantityBase, entered });
  }

  return { lines, fieldErrors };
}

/**
 * The counted figure, converted to whole pieces.
 *
 * Returns null when nothing was counted. Returns an error, never a rounded
 * number, when the unit and the figure do not produce whole eggs.
 */
export function countedToBase(
  counted: number | null,
  unit: CountingUnit,
): { base: number | null; error?: string } {
  if (counted === null) return { base: null };

  const converted = convert(counted, unit, 'piece');
  const base = wholePieces(converted);
  if (base === null) {
    return {
      base: null,
      error:
        `${counted} ${getUnit(unit).name.toLowerCase()} is ${readable(converted)} — not a whole ` +
        `number. Enter the exact figure in pieces instead.`,
    };
  }
  return { base };
}

/**
 * A converted count as a whole number of pieces, or null if it genuinely is not.
 *
 * THE TOLERANCE IS NOT SLOPPINESS, IT IS BINARY FLOATING POINT. 12.1 crates is
 * exactly 363 eggs in decimal, but `12.1 * 30` evaluates to 363.00000000000006,
 * and a bare `Number.isInteger` would refuse a figure that is perfectly whole.
 * Anything further out than this is a real fraction of an egg and is refused.
 */
/**
 * The same number as a person would write it.
 *
 * `1.1 * 12` is 13.200000000000001, and an error message that quotes fourteen
 * decimal places at somebody counting eggs is an error message they stop
 * reading.
 */
function readable(value: number): number {
  return Number(value.toFixed(3));
}

function wholePieces(value: number): number | null {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 1e-6 ? rounded : null;
}
