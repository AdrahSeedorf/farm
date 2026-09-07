import { z } from 'zod';
import { INCIDENT_KINDS, SEVERITIES } from '@/lib/incidents';

/**
 * Incident validation — ADRAH Farms
 *
 * THE REPORT SCHEMA ASKS FOR AS LITTLE AS IT CAN GET AWAY WITH. Every optional
 * field here is optional on purpose: the count of incidents reported is the only
 * number this module has, and it falls with every box somebody has to fill in
 * standing in a poultry house at half past five.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

export const reportSchema = z.object({
  what: z.string().trim().min(5, 'Say what happened, in a few words at least.').max(2000),
  siteId: z.string().trim().min(1, 'Choose which farm.'),
  /** Optional. A report with no category is still a report. */
  kind: z
    .union([z.enum(INCIDENT_KINDS), z.literal('')])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  /**
   * When it HAPPENED, not when it was written down. Somebody finding a hole in
   * the fence at six is reporting something from the night.
   */
  occurredAt: z
    .string()
    .trim()
    .min(1, 'When did it happen?')
    .transform((v) => new Date(`${v}:00.000Z`))
    .refine((d) => !Number.isNaN(d.getTime()), 'That is not a valid time.'),
});

export type ReportInput = z.infer<typeof reportSchema>;

/**
 * A review. THE SEVERITY LIVES HERE, not on the report — see incidents.ts.
 *
 * Even here it is optional: somebody acknowledging a report they cannot yet
 * grade should be able to say "I have seen this" without inventing a judgement,
 * and that acknowledgement is most of the value.
 */
export const reviewSchema = z.object({
  severity: z
    .union([z.enum(SEVERITIES), z.literal('')])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  reviewNote: optionalText(1000),
});

export const closeSchema = z.object({
  outcome: z
    .string()
    .trim()
    .min(3, 'Say what was done about it. That is the whole point of closing it.')
    .max(500),
});
