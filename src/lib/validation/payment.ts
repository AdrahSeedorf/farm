import { z } from 'zod';
import { parseCedis } from '@/lib/money';
import { PAYMENT_METHODS } from '@/lib/payments';

/**
 * Payment validation — ADRAH Farms
 *
 * The amount arrives in cedis and is stored in pesewas, converted here and
 * nowhere else. `parseCedis` returns null for both a blank and for gibberish, so
 * the string is checked while it is still a string — the same trap the price
 * list set, and the same fix.
 */

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

export const paymentSchema = z.object({
  customerId: z.string().trim().min(1, 'Which buyer paid?'),
  amount: z
    .string()
    .trim()
    .min(1, 'How much?')
    .superRefine((v, ctx) => {
      if (parseCedis(v) === null) {
        ctx.addIssue({
          code: 'custom',
          message: 'That is not an amount. Write it like 500 or 500.50.',
        });
      }
    })
    .transform((v) => parseCedis(v)),
  method: z.enum(PAYMENT_METHODS, { message: 'How did the money arrive?' }),
  receivedOn: z
    .string()
    .trim()
    .min(1, 'What day did it arrive?')
    .transform((v) => new Date(`${v}T00:00:00.000Z`))
    .refine((d) => !Number.isNaN(d.getTime()), 'That is not a valid date.'),
  receivedBy: optional(120),
  externalRef: optional(120),
  notes: optional(500),
  /** The fingerprint of the warnings the person actually read. See warnings.ts. */
  acknowledged: optional(64),
});

export const reversePaymentSchema = z.object({
  reason: z.string().trim().min(3, 'Say why in a few words.').max(300),
});
