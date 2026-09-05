import { z } from 'zod';
import { GHANA_REGIONS } from '@/lib/ghana';
import { ITEM_CATEGORIES } from '@/lib/validation/item';

/**
 * Procurement validation — ADRAH Farms
 *
 * Contact details are kept as typed. A supplier form filled in while somebody
 * is on the phone is not the place to reject a number for its punctuation —
 * src/lib/ghana.ts recovers a dialable form when it can, and the screen simply
 * offers no WhatsApp link when it cannot.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

export const supplierSchema = z.object({
  name: z.string().trim().min(2, 'Enter the supplier’s name.').max(80),
  /** Blank is fine — the action derives one from the name. */
  code: optionalText(20),
  contactName: optionalText(80),
  phone: optionalText(24),
  altPhone: optionalText(24),
  email: optionalText(120),
  town: optionalText(80),
  district: optionalText(80),
  region: z
    .enum(GHANA_REGIONS)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /**
   * How long this supplier takes. Blank means "use the farm's own figure" —
   * a real answer, not an unfinished form.
   */
  leadTimeDays: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : Number(v)))
    .refine(
      (v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 365),
      'Enter a whole number of days, or leave it blank to use the farm’s figure.',
    ),
  paymentTerms: optionalText(120),
  notes: optionalText(500),
});

export type SupplierInput = z.infer<typeof supplierSchema>;

/** Which categories a supplier sells. Checkboxes, so read with getAll. */
export function parseSupplies(formData: FormData): string[] {
  const valid = new Set<string>(ITEM_CATEGORIES);
  return formData
    .getAll('supplies')
    .map((v) => String(v))
    .filter((v) => valid.has(v));
}

/**
 * A short code from the name, so paperwork has something to quote.
 *
 * Derived rather than typed for the same reason a grade key is: a code people
 * edit is a code that eventually differs from the one on last year's invoice.
 */
export function supplierCodeFrom(name: string): string {
  return (
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20) || 'SUPPLIER'
  );
}
