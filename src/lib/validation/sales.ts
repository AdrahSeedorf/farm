import { z } from 'zod';
import { parseCedis } from '@/lib/money';

/**
 * Sales order validation — ADRAH Farms
 *
 * The price on a line arrives in cedis and is stored in pesewas, converted here
 * and nowhere else — the same rule as the price list. Blank means "use whatever
 * this buyer's price works out to"; gibberish is an error, not a blank.
 */

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

export const newOrderSchema = z.object({
  customerId: z.string().trim().min(1, 'Which buyer is this for?'),
  siteId: z.string().trim().min(1, 'Which farm is it coming from?'),
  wantedOn: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : new Date(`${v}T00:00:00.000Z`)))
    .refine((d) => d === null || !Number.isNaN(d.getTime()), 'That is not a valid date.'),
  notes: optional(1000),
});

export const lineSchema = z.object({
  productId: z.string().trim().min(1, 'Which product?'),
  quantity: z
    .string()
    .trim()
    .min(1, 'How many?')
    .transform((v) => Number(v))
    .refine((v) => Number.isFinite(v), 'How many? A number.'),
  /**
   * Blank means "use this buyer's price". Gibberish is an error.
   *
   * The same trap as the price list: `parseCedis` returns null for both, so the
   * string is checked while it is still a string.
   */
  price: z
    .string()
    .trim()
    .optional()
    .superRefine((v, ctx) => {
      if (v !== undefined && v !== '' && parseCedis(v) === null) {
        ctx.addIssue({
          code: 'custom',
          message: 'That is not an amount. Write it like 45 or 45.50.',
        });
      }
    })
    .transform((v) => (v === undefined || v === '' ? null : parseCedis(v))),
  note: optional(300),
});

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(3, 'Say why in a few words.').max(300),
});

export const drawnFromSchema = z.object({
  flockId: optional(60),
});
