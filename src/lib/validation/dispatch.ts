import { z } from 'zod';
import { DISPATCH_METHODS } from '@/lib/dispatch';

/**
 * Dispatch validation — ADRAH Farms
 *
 * QUANTITIES ARRIVE ONE PER ORDER LINE, keyed by that line's id, because the
 * form is a list of what was ordered with a box beside each. A single "quantity"
 * field would force one load per product, which is not how a vehicle is loaded.
 *
 * A BLANK BOX IS ZERO, NOT AN ERROR. Most loads carry some of what was ordered
 * and none of the rest; making somebody type 0 into every other row is how a
 * form stops being filled in at all.
 */

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

export const dispatchSchema = z.object({
  method: z.enum(DISPATCH_METHODS, {
    message: 'Say whether the buyer collected it or the farm delivered it.',
  }),
  dispatchedOn: z
    .string()
    .trim()
    .min(1, 'What day did it go out?')
    .transform((v) => new Date(`${v}T00:00:00.000Z`))
    .refine((d) => !Number.isNaN(d.getTime()), 'That is not a valid date.'),
  takenBy: optional(120),
  vehicle: optional(60),
  receivedBy: optional(120),
  notes: optional(1000),
  /** The fingerprint of the warnings the person actually read. See warnings.ts. */
  acknowledged: optional(64),
});

/**
 * One quantity box.
 *
 * Parsed on its own rather than as part of the object above, because the form
 * carries one of these per order line under a generated name and the set is not
 * known until the order is read.
 */
export const quantitySchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? '0' : v))
  .refine((v) => Number.isFinite(Number(v)), 'How many? A number, or leave it blank.')
  .transform((v) => Number(v));

export const reverseDispatchSchema = z.object({
  reason: z.string().trim().min(3, 'Say why in a few words.').max(300),
});
