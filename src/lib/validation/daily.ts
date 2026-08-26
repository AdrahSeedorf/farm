import { z } from 'zod';

/**
 * Daily record validation — ADRAH Farms
 *
 * Everything except the date is optional and defaults to zero. A morning where
 * nothing died is the normal morning, and it should take no typing at all.
 */

const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const recordDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'That date is not valid.')
  .refine((d) => d.getTime() <= todayUtc().getTime(), 'That date is in the future.');

/**
 * NOTE ON EMPTY FIELDS — a trap worth naming.
 *
 * `z.coerce.number()` turns `""` into `0`, because `Number("") === 0`. So a
 * union of `[coerce.number(), literal("")]` never reaches the empty branch: the
 * blank field silently becomes zero.
 *
 * For a bird count that is harmless — blank does mean none died. For a MEASURED
 * quantity it is a lie: "we gave no feed today" and "nobody measured the feed"
 * are different claims, and averaging the second as a zero drags every feed
 * figure downward for as long as the records exist.
 *
 * Form data arrives as strings, so both helpers below read the string first and
 * decide what emptiness means, rather than letting coercion decide for them.
 */

/** A count of birds. Blank genuinely means none. */
const count = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? 0 : Number(v)))
  .refine(
    (v) => Number.isInteger(v) && v >= 0 && v <= 1_000_000,
    'Whole birds only, and not negative.',
  );

/** A measured quantity. Blank means NOT MEASURED, which is not zero. */
const measure = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : Number(v)))
  .refine(
    (v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 1_000_000),
    'Enter a number, or leave it blank if you did not measure it.',
  );

export const dailyRecordSchema = z.object({
  onDate: recordDate,
  mortality: count,
  culls: count,
  feedKg: measure,
  waterLitres: measure,
  observations: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  /** Reason code applied to the mortality event, when one is chosen. */
  mortalityReason: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  cullReason: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  /**
   * Generated when the form is rendered and submitted with it.
   *
   * A phone on a poor connection retries; without this, one morning's mortality
   * is recorded twice and the flock loses birds it still has. The unique
   * constraint rejects the second attempt outright rather than merging it.
   */
  idempotencyKey: z.string().trim().min(8).max(64),
  /** Set when the person has seen the warnings and chosen to continue. */
  acknowledgeWarnings: z
    .union([z.literal('on'), z.literal('true'), z.literal('')])
    .optional()
    .transform((v) => v === 'on' || v === 'true'),
});

export type DailyRecordInput = z.infer<typeof dailyRecordSchema>;
