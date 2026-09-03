import { z } from 'zod';
import { ALLOCATION_METHODS } from '@/lib/cost-allocation';
import { COST_CATEGORIES } from '@/lib/flock-costing';
import { parseCedis } from '@/lib/money';

/**
 * Cost entry validation — ADRAH Farms
 *
 * The amount is the field that matters. It arrives as whatever a person typed
 * into a phone — "480", "480.00", "GHS 480", "1,250" — and leaves as an integer
 * number of pesewas or as a field error. It is never coerced to zero, because a
 * cost silently recorded as free is a cost that will never be found again.
 */

const requiredDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.')
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

const optionalDate = z
  .union([requiredDate, z.literal('')])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : (v as Date)));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

/**
 * Cedis as typed, into pesewas.
 *
 * Rejects rather than rounds when the input is unreadable. `parseCedis` handles
 * the currency symbol and thousands separators people type without thinking.
 */
const cedis = z
  .string()
  .trim()
  .min(1, 'Enter the amount.')
  .transform((v, ctx) => {
    const parsed = parseCedis(v);
    if (parsed === null) {
      ctx.addIssue({ code: 'custom', message: 'That is not an amount — try 480 or 480.50.' });
      return z.NEVER;
    }
    return parsed;
  });

export const allocationSchema = z.object({
  category: z.enum(COST_CATEGORIES, { message: 'Choose what the cost was for.' }),
  amount: cedis,
  incurredOn: requiredDate,
  description: z
    .string()
    .trim()
    .min(3, 'Say what this cost was — "July wages", "ECG bill", not just a number.')
    .max(120),
  reference: optionalText(60),
  method: z.enum(ALLOCATION_METHODS, { message: 'Choose how to divide it.' }),
  periodStart: optionalDate,
  periodEnd: optionalDate,
});

export type AllocationInputFields = z.infer<typeof allocationSchema>;

export const reversalSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(4, 'Say why this is being reversed — it stays on the record.')
    .max(160),
});

/**
 * The per-flock shares from a MANUAL split.
 *
 * Parsed separately from the form body because they arrive as one field per
 * flock (`share:<flockId>`), which no fixed schema can describe. Anything
 * unreadable comes back as null so the caller can report the flock by name
 * rather than failing the whole form with "invalid input".
 */
export function parseManualShares(formData: FormData): Record<string, number | null> {
  const shares: Record<string, number | null> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('share:')) continue;
    const flockId = key.slice('share:'.length);
    const raw = String(value).trim();
    shares[flockId] = raw === '' ? 0 : parseCedis(raw);
  }
  return shares;
}

/** Which flocks were ticked. */
export function parseSelectedFlocks(formData: FormData): string[] {
  return formData
    .getAll('flockId')
    .map((v) => String(v))
    .filter((v) => v.length > 0);
}
