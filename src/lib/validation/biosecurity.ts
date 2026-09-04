import { z } from 'zod';

/**
 * Biosecurity validation — ADRAH Farms
 *
 * The visitor form is filled in at a gate, on a phone, often by someone holding
 * something else. Everything except a name and a kind is optional, and the
 * blanks are recorded as blanks rather than as zeroes or as noes — "nobody
 * recorded whether they used the footbath" and "they did not use the footbath"
 * are different facts and the log has to keep them apart.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

/** A datetime-local value, e.g. "2026-09-04T08:30". */
const optionalDateTime = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === '') return null;
    const parsed = new Date(v.length === 16 ? `${v}:00.000Z` : v);
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Use the date and time picker.' });
      return z.NEVER;
    }
    return parsed;
  });

const requiredDateTime = z
  .string()
  .trim()
  .min(1, 'When did they arrive?')
  .transform((v, ctx) => {
    const parsed = new Date(v.length === 16 ? `${v}:00.000Z` : v);
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Use the date and time picker.' });
      return z.NEVER;
    }
    return parsed;
  });

/**
 * A three-state answer submitted as a string.
 *
 * "yes" / "no" / "" — and the blank is kept as null rather than coerced to
 * false. A footbath nobody recorded is not a footbath that went unused, and an
 * inspection reading this log next year needs to see the difference.
 */
const tristate = z
  .enum(['yes', 'no', ''])
  .optional()
  .transform((v) => (v === 'yes' ? true : v === 'no' ? false : null));

export const VISITOR_KINDS = [
  'VETERINARIAN',
  'SUPPLIER',
  'BUYER',
  'CONTRACTOR',
  'INSPECTOR',
  'STAFF_RETURNING',
  'NEIGHBOUR',
  'OTHER',
] as const;

export type VisitorKind = (typeof VISITOR_KINDS)[number];

export const VISITOR_KIND_LABELS: Record<VisitorKind, string> = {
  VETERINARIAN: 'Veterinarian',
  SUPPLIER: 'Supplier or delivery',
  BUYER: 'Buyer or trader',
  CONTRACTOR: 'Contractor',
  INSPECTOR: 'Inspector or official',
  STAFF_RETURNING: 'Staff returning from elsewhere',
  NEIGHBOUR: 'Neighbour',
  OTHER: 'Other',
};

export const CONTACT_DECLARATIONS = ['NOT_DECLARED', 'NONE', 'AT'] as const;
export type ContactDeclarationKind = (typeof CONTACT_DECLARATIONS)[number];

export const DECLARATION_LABELS: Record<ContactDeclarationKind, string> = {
  NONE: 'They have not been near other poultry',
  AT: 'They gave a date and time',
  NOT_DECLARED: 'Not asked, or they did not say',
};

export const visitorSchema = z
  .object({
    siteId: z.string().trim().min(1, 'Choose a farm.'),
    name: z.string().trim().min(2, 'Enter their name.').max(80),
    organisation: optionalText(80),
    /**
     * Left as typed. Ghanaian numbers arrive as "024 123 4567", "+233241234567"
     * and everything between; normalising them here would reject a real number
     * at a gate, which is the last place to argue about formatting.
     */
    phone: optionalText(24),
    kind: z.enum(VISITOR_KINDS, { message: 'What kind of visit was it?' }),
    purpose: optionalText(120),
    arrivedAt: requiredDateTime,
    declaration: z.enum(CONTACT_DECLARATIONS),
    lastPoultryContactAt: optionalDateTime,
    vehicleRegistration: optionalText(20),
    enteredProductionUnit: z.enum(['yes', 'no']).transform((v) => v === 'yes'),
    usedFootbath: tristate,
    woreFarmClothing: tristate,
    notes: optionalText(500),
  })
  .refine((v) => v.declaration !== 'AT' || v.lastPoultryContactAt !== null, {
    path: ['lastPoultryContactAt'],
    message: 'Give the date and time, or change the answer above.',
  })
  .refine(
    (v) =>
      v.lastPoultryContactAt === null || v.lastPoultryContactAt <= v.arrivedAt,
    {
      path: ['lastPoultryContactAt'],
      message: 'That is after they arrived here.',
    },
  );

export type VisitorInput = z.infer<typeof visitorSchema>;

export const departureSchema = z.object({
  departedAt: requiredDateTime,
});

/** Hours a visitor should be clear of other poultry. Blank means no rule. */
export const downtimeSchema = z.object({
  visitorDowntimeHours: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : Number(v)))
    .refine(
      (v) => v === null || (Number.isInteger(v) && v > 0 && v <= 336),
      'Enter a whole number of hours, up to two weeks — or leave it blank for no rule.',
    ),
});
