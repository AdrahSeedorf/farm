import { z } from 'zod';
import { ROLES } from '@/lib/rbac';
import { MIN_PASSWORD_LENGTH } from '@/lib/password';

/**
 * Staff account validation — ADRAH Farms
 *
 * Shape only. Whether a particular person may GRANT what is in here is a
 * different question entirely, answered by staff.ts and enforced in the service.
 * Keeping the two apart matters: a schema that also decided authority would be
 * a schema somebody could satisfy their way past.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

export const staffSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter their name.').max(80),
    /**
     * BOTH ARE OPTIONAL, and at least one is required — see the refinement.
     *
     * Farm staff have a phone and no email; the owner has both. Making either
     * one mandatory would exclude one of those two groups from the system, and
     * inventing a placeholder email for a farmhand is how a fake address ends
     * up receiving a password reset.
     */
    email: z
      .union([z.string().trim().toLowerCase().email('That is not a valid email address.'), z.literal('')])
      .optional()
      .transform((v) => (v === '' || v === undefined ? null : v)),
    phone: optionalText(24),
    notes: optionalText(500),
  })
  .refine((v) => v.email !== null || v.phone !== null, {
    message: 'Give them an email address or a phone number — they cannot sign in without one.',
    path: ['phone'],
  });

export type StaffInput = z.infer<typeof staffSchema>;

/** Roles, as checkboxes. Read with getAll; unknown values are dropped, not errors. */
export function parseRoles(formData: FormData): string[] {
  const valid = new Set<string>(ROLES);
  return formData
    .getAll('roles')
    .map((v) => String(v))
    .filter((v) => valid.has(v));
}

/**
 * Site scope, as checkboxes.
 *
 * BEWARE: an empty result means "every farm", not "no farms" — the convention
 * from scope.ts. The screen therefore offers an explicit "every farm" choice
 * rather than letting an unticked list mean it by accident, and the service
 * checks the granter is allowed to give it.
 */
export function parseSiteScope(formData: FormData): { everySite: boolean; siteIds: string[] } {
  const everySite = formData.get('siteScopeMode') === 'all';
  return {
    everySite,
    siteIds: everySite ? [] : formData.getAll('siteIds').map((v) => String(v)),
  };
}

export const pinSchema = z.object({
  pin: z.string().trim().min(1, 'Enter a PIN.'),
  confirmPin: z.string().trim().min(1, 'Type it again.'),
});

export const passwordSchema = z
  .object({
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'The two do not match.',
    path: ['confirmPassword'],
  });
