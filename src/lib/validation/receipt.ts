import { z } from 'zod';

/**
 * Goods receipt validation — ADRAH Farms
 *
 * One schema, used by the form and the server action. Every optional field
 * distinguishes BLANK from ZERO, for the reason set out at length in
 * `validation/daily.ts`: a price of nothing and a price nobody recorded are
 * different facts, and averaging the second as zero makes feed look free.
 */

const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'That date is not valid.');

/**
 * A delivery date, never in the future.
 *
 * The client `max` attribute is a hint the browser may or may not honour and a
 * scripted request ignores entirely, so the rule is enforced here — the same
 * lesson as the flock hatch date, which briefly allowed a flock aged minus
 * twenty-one weeks.
 */
const deliveryDate = isoDate.refine(
  (d) => d.getTime() <= todayUtc().getTime(),
  'A delivery cannot be recorded for a future date.',
);

/**
 * An expiry date, which MAY be in the future — that is the normal case — and may
 * also be in the past, because stock does sometimes arrive already expired and
 * the farm needs to be able to record that rather than pretend otherwise.
 */
const expiryDate = z
  .union([isoDate, z.literal('')])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : (v as Date)));

/** A received quantity. Must be positive: a receipt of nothing is not a receipt. */
const quantity = z
  .string()
  .trim()
  .min(1, 'Enter how much arrived.')
  .transform((v) => Number(v))
  .refine(
    (v) => Number.isFinite(v) && v > 0 && v <= 10_000_000,
    'Enter a quantity greater than zero.',
  );

/** An invoice price in cedis, per entered unit. Blank means NOT RECORDED. */
const price = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : Number(v)))
  .refine(
    (v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 100_000_000),
    'Enter a price in cedis, or leave it blank if the invoice has not arrived.',
  );

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

export const receiptSchema = z.object({
  itemId: z.string().trim().min(1, 'Choose an item.'),
  stockLocationId: z.string().trim().min(1, 'Choose a store.'),
  quantity,
  enteredUomKey: z.string().trim().min(1, 'Choose a unit.'),
  occurredOn: deliveryDate,
  /** Blank is allowed — the service stamps a date-based batch number. */
  batchNumber: optionalText(40),
  expiresOn: expiryDate,
  priceCedis: price,
  /**
   * Supplier and waybill, as free text FOR NOW.
   *
   * Deliberately not a Supplier relation yet. Procurement is its own milestone,
   * and inventing half a supplier model here — a name column that later has to
   * be reconciled against real supplier records — would create exactly the
   * duplicate source of truth the rest of this system avoids.
   */
  reference: optionalText(120),
  notes: optionalText(500),
  /** The fingerprint of the warnings the person was actually shown. */
  acknowledgedToken: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
});

export type ReceiptInput = z.infer<typeof receiptSchema>;
