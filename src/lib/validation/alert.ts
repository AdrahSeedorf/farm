import { z } from 'zod';

/**
 * Alert acknowledgement validation — ADRAH Farms
 *
 * The note is required here as well as in `parkErrors`, and the duplication is
 * deliberate: this rejects a malformed submission, that one states the rule.
 * A schema is not the place to explain why a parked alert needs a reason.
 */
export const parkSchema = z.object({
  alertKey: z.string().trim().min(3).max(200),
  note: z
    .string()
    .trim()
    .min(3, 'Say why in a few words.')
    .max(300),
  until: z
    .string()
    .trim()
    .min(1, 'Choose when this should come back.')
    .transform((v) => new Date(`${v}T00:00:00.000Z`))
    .refine((d) => !Number.isNaN(d.getTime()), 'That is not a valid date.'),
});

export type ParkInput = z.infer<typeof parkSchema>;

export const liftSchema = z.object({
  parkId: z.string().trim().min(1),
});
