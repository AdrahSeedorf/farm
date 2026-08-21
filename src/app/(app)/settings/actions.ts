'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { organisationSchema, fieldErrorsFrom } from '@/lib/validation/site';
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
