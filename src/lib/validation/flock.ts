import { z } from 'zod';
import { REASON_CODES } from '@/lib/reason-codes';

const reasonKeys = REASON_CODES.map((c) => c.key) as [string, ...string[]];

/** A date the user typed, as yyyy-mm-dd, interpreted at UTC midnight. */
const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'That date is not valid.');

/**
 * Today at UTC midnight. Ghana is UTC+0 with no daylight saving, so the
 * farm's calendar day and UTC's agree — which is why the whole system stores
 * dates this way.
 */
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * A date that cannot be in the future.
 *
 * The `max` attribute on a date input is a courtesy to the person typing, NOT a
 * control — it is trivially bypassed, and a server action can be called without
 * ever rendering the form.
 *
 * This matters more here than in most places. A hatch date typed as 2027 instead
 * of 2026 gives the flock a NEGATIVE age, and age is the spine of this system:
 * vaccination scheduling, lay-curve comparison, body-weight targets and stage
 * transitions all hang off it. The flock would look plausible and every derived
 * number would be wrong.
 */
const pastOrToday = dateOnly.refine((d) => d.getTime() <= todayUtc().getTime(), {
  message: 'That date is in the future.',
});

/**
 * Placement — creating a flock.
 *
 * `dateOfHatch` is separate from `arrivalDate` on purpose: age drives every
 * vaccination schedule and every performance comparison, and a flock delivered
 * three days late is still the age it hatched.
 */
export const placementSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(3, 'At least 3 characters.')
      .max(20)
      .regex(/^[A-Z0-9-]+$/, 'Letters, numbers and hyphens only.'),
    name: z.string().trim().max(80).optional().transform((v) => (v === '' ? undefined : v)),
    productionUnitId: z.string().trim().min(1, 'Choose a house.'),
    breed: z.string().trim().max(60).optional().transform((v) => (v === '' ? undefined : v)),
    supplierName: z
      .string()
      .trim()
      .max(80)
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
    dateOfHatch: pastOrToday,
    arrivalDate: pastOrToday,
    quantity: z.coerce
      .number()
      .int('Whole birds only.')
      .positive('Must be more than zero.')
      .max(1_000_000),
    /** Dead on arrival, recorded as its own mortality event on the arrival date. */
    deadOnArrival: z.coerce.number().int().min(0).max(1_000_000).optional().default(0),
    /** Total paid for the chicks, in cedis. Starts the flock's cost ledger. */
    purchaseCostCedis: z
      .union([z.coerce.number().min(0).max(100_000_000), z.literal('')])
      .optional()
      .transform((v) => (v === '' || v === undefined ? undefined : Number(v))),
    notes: z.string().trim().max(500).optional().transform((v) => (v === '' ? undefined : v)),
  })
  .refine((data) => data.arrivalDate >= data.dateOfHatch, {
    message: 'Birds cannot arrive before they hatched.',
    path: ['arrivalDate'],
  })
  .refine((data) => data.deadOnArrival <= data.quantity, {
    message: 'Dead on arrival cannot exceed the number received.',
    path: ['deadOnArrival'],
  })
  .refine(
    (data) => {
      // A "day-old" chick more than 3 weeks past hatch is almost certainly a typo.
      const ageAtArrival =
        (data.arrivalDate.getTime() - data.dateOfHatch.getTime()) / 86_400_000;
      return ageAtArrival <= 400;
    },
    { message: 'That is over a year between hatch and arrival — check the dates.', path: ['dateOfHatch'] },
  );

export type PlacementInput = z.infer<typeof placementSchema>;

/** Recording mortality, culls, sales, transfers and corrections. */
export const flockEventSchema = z.object({
  type: z.enum(['MORTALITY', 'CULL', 'SALE', 'TRANSFER_OUT', 'ADJUSTMENT']),
  quantity: z.coerce
    .number()
    .int('Whole birds only.')
    .refine((n) => n !== 0, 'Enter a number of birds.')
    .refine((n) => Math.abs(n) <= 1_000_000, 'That number is too large.'),
  occurredOn: pastOrToday,
  reasonCode: z.enum(reasonKeys).optional().or(z.literal('').transform(() => undefined)),
  notes: z.string().trim().max(500).optional().transform((v) => (v === '' ? undefined : v)),
});

export type FlockEventInput = z.infer<typeof flockEventSchema>;

export const stageChangeSchema = z.object({
  toStageId: z.string().trim().min(1, 'Choose a stage.'),
  occurredOn: pastOrToday,
  notes: z.string().trim().max(500).optional().transform((v) => (v === '' ? undefined : v)),
});
