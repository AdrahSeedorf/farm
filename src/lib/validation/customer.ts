import { z } from 'zod';
import { CUSTOMER_KINDS } from '@/lib/customers';

/**
 * Customer validation — ADRAH Farms
 *
 * TWO REQUIRED FIELDS: a name and a number. Everything else is optional, for
 * the same reason the enquiry form asks for almost nothing — this gets filled
 * in at a counter with somebody waiting, and every extra required box is a sale
 * recorded against "walk-in" instead of against a buyer.
 *
 * THE PHONE IS NOT VALIDATED AS GHANAIAN. The service normalises what it can
 * and keeps the rest as typed; a number this software cannot parse is still a
 * number a person can ring, and refusing it would turn away a buyer calling
 * from outside Ghana or one whose number has an unexpected space in it.
 */

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

export const customerSchema = z.object({
  kind: z.enum(CUSTOMER_KINDS),
  name: z.string().trim().min(2, 'Give them a name — whatever you would call them.').max(120),
  phone: z
    .string()
    .trim()
    .min(6, 'A number you can reach them on. However you write it.')
    .max(30),
  businessName: optional(160),
  email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v))
    .refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), {
      message: 'That email address does not look right. Leave it blank if you would rather.',
    }),
  town: optional(120),
  notes: optional(2000),
  fromEnquiryId: optional(60),
});

export type CustomerInput = z.infer<typeof customerSchema>;

export const archiveCustomerSchema = z.object({
  reason: z.string().trim().min(3, 'Say why in a few words.').max(300),
});
