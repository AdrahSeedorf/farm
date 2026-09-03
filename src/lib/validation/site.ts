import { z } from 'zod';
import { GHANA_REGIONS } from '@/lib/ghana';

/**
 * Validation schemas — shared by the form and the server action.
 *
 * ONE schema, used in both places. The alternative — client-side rules that
 * drift from server-side rules — is how a field ends up validated in the browser
 * and unvalidated where it matters.
 */

/**
 * A short code typed by people and printed on things. Uppercase letters, digits
 * and hyphens only: it ends up in flock references, on house doors, and in CSV
 * exports, where a stray space or slash causes trouble for years.
 */
const code = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'At least 2 characters.')
  .max(12, 'At most 12 characters.')
  .regex(/^[A-Z0-9-]+$/, 'Letters, numbers and hyphens only.');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

export const siteSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name.').max(80),
  code,
  region: z
    .enum(GHANA_REGIONS)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  district: optionalText(80),
  town: optionalText(80),
});

export type SiteInput = z.infer<typeof siteSchema>;

export const productionUnitSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(60),
  code,
  /**
   * Advisory only. It is never used to reject a placement — a farm that puts
   * 1,300 birds in a house rated for 1,250 has made an operational decision, and
   * software that blocks recording reality just means reality stops being
   * recorded.
   */
  capacity: z
    .union([z.coerce.number().int().positive().max(1_000_000), z.literal('')])
    .optional()
    .transform((v) => (v === '' || v === undefined ? undefined : Number(v))),
  notes: optionalText(500),
});

export type ProductionUnitInput = z.infer<typeof productionUnitSchema>;

export const organisationSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name.').max(80),
  legalName: optionalText(120),
  /**
   * Days between placing a stock order and receiving it.
   *
   * A setting rather than a constant because it is the threshold every "days of
   * cover" judgement is measured against: four days of feed is comfortable with
   * a next-day supplier and an emergency with a fortnightly one.
   */
  stockLeadTimeDays: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 7 : Number(v)))
    .refine(
      (v) => Number.isInteger(v) && v >= 0 && v <= 365,
      'Enter a whole number of days, up to a year.',
    ),
  /** Currency and timezone are deliberately not editable yet — see the settings page. */
});

export type OrganisationInput = z.infer<typeof organisationSchema>;

/**
 * Flatten Zod issues into a per-field map for the form.
 *
 * Walks `issues` directly rather than using `flattenError`, because that helper's
 * return type depends on the schema's generic parameter — which a shared helper
 * accepting any `ZodError` does not have, leaving the field map typed as `{}`.
 * Reading the issues is both better typed and clearer about what it does.
 *
 * Only the FIRST message per field is kept: showing a person three complaints
 * about one input at once is noise, and they can only fix one at a time anyway.
 */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !(key in result)) {
      result[key] = issue.message;
    }
  }
  return result;
}

export const breedSchema = z.object({
  name: z.string().trim().min(2, 'Enter a breed name.').max(60),
  supplier: optionalText(80),
});

export type BreedInput = z.infer<typeof breedSchema>;
