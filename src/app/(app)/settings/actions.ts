'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { organisationSchema, breedSchema, fieldErrorsFrom } from '@/lib/validation/site';
import type { FormState } from '../sites/actions';

export async function updateOrganisation(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const principal = await requirePermission('settings:manage');

  const parsed = organisationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const before = await db.organisation.findUnique({
    where: { id: principal.organisationId },
  });
  if (!before) return { error: 'Organisation not found.' };

  const after = await db.organisation.update({
    where: { id: principal.organisationId },
    data: parsed.data,
  });

  await recordAudit({
    principal,
    action: 'organisation.update',
    entityType: 'Organisation',
    entityId: after.id,
    before,
    after,
  });

  revalidatePath('/settings');
  return { error: undefined, fieldErrors: undefined };
}

/**
 * Add a breed to the catalogue.
 *
 * The NAME only. Weight figures are loaded from the breeder's own management
 * guide with `npm run standards:load`, because a curve typed in by hand is a
 * curve nobody can trace back to a source — and a flock would then be judged
 * behind target against numbers with no provenance.
 */
export async function addBreed(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePermission('settings:manage');

  const parsed = breedSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const input = parsed.data;

  // Derived so the loader has something stable to target on the command line.
  const key = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const existing = await db.breed.findFirst({
    where: { organisationId: principal.organisationId, key },
  });
  if (existing) {
    return { fieldErrors: { name: `${existing.name} is already in the catalogue.` } };
  }

  const breed = await db.breed.create({
    data: {
      organisationId: principal.organisationId,
      key,
      name: input.name,
      supplier: input.supplier,
    },
  });

  await recordAudit({
    principal,
    action: 'organisation.update',
    entityType: 'Breed',
    entityId: breed.id,
    after: { key, name: input.name, supplier: input.supplier },
  });

  revalidatePath('/settings');
  return { ok: `${breed.name} added. Load its weight table with: npm run standards:load -- <file.csv> --breed ${key}` };
}
