import { z } from 'zod';

/**
 * Enquiry validation — ADRAH Farms
 *
 * THE SHORTEST FORM THAT IS STILL USEFUL. Two required fields: who you are and
 * how to reach you. Everything else is optional, because this is the farm's only
 * channel before the first egg and the number of enquiries it collects falls
 * with every box a buyer has to fill in on a phone with one hand.
 *
 * The messages are written to be read by a customer, not a developer. Nobody
 * outside this building should ever see the word "invalid".
 */

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

export const enquirySchema = z.object({
  kind: z.enum(['WHOLESALE', 'GENERAL']),

  name: z
    .string()
    .trim()
    .min(2, 'Please tell us your name.')
    .max(120),

  /**
   * NOT VALIDATED AS A GHANAIAN NUMBER HERE.
   *
   * The service normalises what it can and keeps the rest as typed. Rejecting a
   * number this software cannot parse would turn away a buyer calling from
   * outside Ghana, or one whose number has a space this regex did not expect —
   * and a number a person can ring is worth more than a column that always
   * parses. All this checks is that somebody put something in the box.
   */
  phone: z
    .string()
    .trim()
    .min(6, 'Please leave a number we can reach you on.')
    .max(30),

  email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v))
    .refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), {
      message: 'That email address does not look right. Leave it blank if you would rather.',
    }),

  businessName: optional(160),

  /**
   * "About 20" is a real answer, so the box takes text and the digits are pulled
   * out of it. A buyer who cannot answer exactly should not be stopped by a
   * number field.
   */
  cratesPerWeek: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => {
      if (!v) return null;
      const digits = v.match(/\d+/);
      if (!digits) return null;
      const n = Number(digits[0]);
      return Number.isFinite(n) && n > 0 && n < 1_000_000 ? n : null;
    }),

  fromWhen: optional(60),
  message: optional(2000),

  /**
   * THE HONEYPOT. A field a person never sees and a crude bot always fills in.
   *
   * Chosen over a CAPTCHA deliberately: a CAPTCHA costs every real customer time
   * and some of them the enquiry entirely, needs third-party JavaScript on a page
   * whose whole budget is 150 KB, and sends the farm's visitors to somebody
   * else's servers. This costs nothing, needs no script, and stops the traffic
   * that actually shows up to a small farm's contact form.
   */
  website: z.string().max(200).optional(),
});

export type EnquiryInput = Omit<z.infer<typeof enquirySchema>, 'website'>;

/** True when the honeypot was filled in — a submission no person made. */
export function looksAutomated(input: { website?: string }): boolean {
  return typeof input.website === 'string' && input.website.trim().length > 0;
}
