import { z } from 'zod';
import { parseCedis } from '@/lib/money';

/**
 * Product and price validation — ADRAH Farms
 *
 * THE PRICE ARRIVES IN CEDIS AND IS STORED IN PESEWAS, and the conversion
 * happens exactly here. `parseCedis` is the only route from what somebody typed
 * to what is stored, so no call site can ever put a cedi figure into a pesewa
 * column and quietly make a crate a hundred times cheaper.
 */

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

export const productSchema = z.object({
  sku: z.string().trim().min(2, 'Give it a short code.').max(40),
  name: z.string().trim().min(2, 'Give the product a name.').max(120),
  gradeId: optional(60),
  unitsPerPack: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 1 : Number(v)))
    .refine(
      (v) => Number.isInteger(v) && v >= 1 && v <= 10_000,
      'How many go in one? A whole number, at least one.',
    ),
  packLabel: z
    .string()
    .trim()
    .min(2, 'What is one of these called? "crate", "tray", "bird".')
    .max(30),
  notes: optional(1000),
});

export type ProductInput = z.infer<typeof productSchema>;

export const priceSchema = z.object({
  productId: z.string().trim().min(1),
  /** Blank means the list price — what anybody pays. */
  customerId: optional(60),
  /**
   * Blank means the agreement ends and this buyer returns to the list price.
   *
   * ONLY MEANINGFUL WITH A CUSTOMER. A blank list price would mean "nobody can
   * be quoted for this", which is what removing the product is for — the action
   * refuses it rather than storing a row that makes a product unquotable.
   */
  /*
   * BLANK AND UNPARSEABLE ARE DIFFERENT THINGS, and `parseCedis` returns null
   * for both. Transforming first and checking afterwards would make "abc" mean
   * exactly what an empty box means — quietly ending a buyer's price agreement
   * because somebody mistyped. So the string is checked while it is still a
   * string, and only then converted.
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
  effectiveFrom: z
    .string()
    .trim()
    .min(1, 'From when does this price apply?')
    .transform((v) => new Date(`${v}T00:00:00.000Z`))
    .refine((d) => !Number.isNaN(d.getTime()), 'That is not a valid date.'),
  note: optional(300),
});

export type PriceFormInput = z.infer<typeof priceSchema>;

/** What the service takes: pesewas, already parsed. */
export interface PriceInput {
  productId: string;
  customerId: string | null;
  pricePesewas: number | null;
  effectiveFrom: Date;
  note: string | null;
}
