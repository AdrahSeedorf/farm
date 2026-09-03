import { z } from 'zod';
import { EVENT_TYPES, ROUTES } from '@/lib/health-programme';

/**
 * Health programme validation — ADRAH Farms
 *
 * Nothing here supplies clinical content. Every field is something a person
 * typed or pasted, and the rules below only check that it is readable.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

const optionalDate = z
  .union([
    z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.')
      .transform((v) => new Date(`${v}T00:00:00.000Z`)),
    z.literal(''),
  ])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : (v as Date)));

/** Blank means NOT STATED. Never coerced to zero — see validation/daily.ts. */
const optionalDays = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : Number(v)))
  .refine(
    (v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 365),
    'Enter a whole number of days, or leave it blank if none was stated.',
  );

export const programmeSchema = z.object({
  name: z.string().trim().min(2, 'Give the programme a name.').max(80),
  description: optionalText(500),
  /** Who supplied the content — hatchery, breeder guide, vet. */
  sourceName: optionalText(80),
  sourceRole: optionalText(80),
  reviewedOn: optionalDate,
});

export type ProgrammeInput = z.infer<typeof programmeSchema>;

export const programmeItemSchema = z.object({
  ageDays: z
    .string()
    .trim()
    .min(1, 'Enter the age in days.')
    .transform((v) => Number(v))
    .refine(
      (v) => Number.isInteger(v) && v >= 0 && v <= 1200,
      'Enter a whole number of days, from 0.',
    ),
  name: z.string().trim().min(2, 'What is being given?').max(80),
  eventType: z.enum(EVENT_TYPES),
  route: z
    .union([z.enum(ROUTES), z.literal('')])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  dosePerBird: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : Number(v)))
    .refine(
      (v) => v === null || (Number.isFinite(v) && v > 0 && v <= 100_000),
      'Enter a dose greater than zero, or leave it blank.',
    ),
  windowDays: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 2 : Number(v)))
    .refine(
      (v) => Number.isInteger(v) && v >= 0 && v <= 60,
      'Enter a whole number of days either side.',
    ),
  eggWithdrawalDays: optionalDays,
  meatWithdrawalDays: optionalDays,
  itemId: optionalText(40),
  notes: optionalText(300),
});

export type ProgrammeItemInput = z.infer<typeof programmeItemSchema>;

/**
 * Approval requires a NAME. Approval by nobody is not oversight, it is a
 * checkbox — and the whole point of this field is that a later reader can ask
 * a specific person what they were thinking.
 */
export const approvalSchema = z.object({
  approvedByName: z
    .string()
    .trim()
    .min(2, 'Enter the name of the veterinarian who reviewed this.')
    .max(80),
  approvedByRole: optionalText(80),
  approvedOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date they reviewed it.')
    .transform((v) => new Date(`${v}T00:00:00.000Z`))
    .refine((d) => !Number.isNaN(d.getTime()), 'That date is not valid.')
    .refine((d) => {
      const now = new Date();
      const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      return d.getTime() <= today;
    }, 'A review cannot be dated in the future.'),
});

export type ApprovalInput = z.infer<typeof approvalSchema>;

export const programmeImportSchema = z.object({
  table: z.string().trim().min(10, 'Paste the table from your vet or hatchery.'),
  /** Replace what is there, or add to it. */
  mode: z.enum(['replace', 'append']).default('append'),
});

export type ProgrammeImportInput = z.infer<typeof programmeImportSchema>;
