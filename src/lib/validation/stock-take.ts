import { z } from 'zod';

/**
 * Stock take validation — ADRAH Farms
 *
 * THE LINES ARE NOT IN THIS SCHEMA, and that is on purpose.
 *
 * A count sheet has one row per item and the item list is data, so the field
 * names are built at render time: `count-<itemId>`, `cause-<itemId>`. A Zod
 * object cannot describe a shape it does not know in advance, and faking one
 * with a passthrough would mean the schema validated nothing while appearing to.
 * The header is validated here; the lines are walked explicitly in the action,
 * where every field is read by name and anything unrecognised is ignored rather
 * than trusted.
 *
 * NOTHING IN THE FORM DECIDES ARITHMETIC. The unit a figure is in and the
 * figure the ledger holds are both looked up on the server. The only numbers
 * that come from the browser are the ones a person actually typed.
 */

export const stockTakeHeaderSchema = z.object({
  stockLocationId: z.string().trim().min(1, 'Which store was counted?'),
  countedOn: z
    .string()
    .trim()
    .min(1, 'What day was it counted?')
    .transform((v) => new Date(`${v}T00:00:00.000Z`))
    .refine((d) => !Number.isNaN(d.getTime()), 'That is not a valid date.'),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  /** The fingerprint of the warnings the person actually read. See warnings.ts. */
  acknowledged: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
});

/**
 * One typed count, while it is still a string.
 *
 * BLANK IS NOT ZERO. An empty box means nobody counted that item, and a zero
 * means somebody looked at an empty shelf. Collapsing the two would turn every
 * item a storekeeper walked past into a claim that it had run out — and that
 * claim would write adjustments emptying the store.
 */
export function parseCount(raw: FormDataEntryValue | null): number | null | 'invalid' {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return 'invalid';
  return value;
}
