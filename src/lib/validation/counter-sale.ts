import { z } from 'zod';
import { parseCedis } from '@/lib/money';
import { BUYER_MODES } from '@/lib/counter-sale';

/**
 * Counter sale validation — ADRAH Farms
 *
 * Quantities and prices arrive one per product, keyed by product id, because the
 * screen is the price list with a box beside each row. A blank box is "none of
 * that", not an error — most gate sales are one product out of six.
 */

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

export const counterSaleSchema = z.object({
  siteId: z.string().trim().min(1, 'Which farm is it coming from?'),
  buyerMode: z.enum(BUYER_MODES, { message: 'Who is buying?' }),
  customerId: optional(60),
  buyerName: optional(120),
  buyerPhone: optional(40),
  flockId: optional(60),
  takenBy: optional(120),
  notes: optional(500),
  /** The fingerprint of the warnings the person actually read. See warnings.ts. */
  acknowledged: optional(64),
});

/** One quantity box. Blank means none of that product went. */
export const quantitySchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? '0' : v))
  .refine((v) => Number.isFinite(Number(v)), 'How many? A number, or leave it blank.')
  .transform((v) => Number(v));

/**
 * One price box.
 *
 * Blank means "whatever this buyer's price works out to". Gibberish is an error,
 * not a blank — the same trap `parseCedis` sets on the price list, checked while
 * the value is still a string.
 */
export const priceSchema = z
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
  .transform((v) => (v === undefined || v === '' ? null : parseCedis(v)));
