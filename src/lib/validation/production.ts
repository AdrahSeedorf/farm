import { z } from 'zod';

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
