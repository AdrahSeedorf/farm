'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import {
  reportIncident,
  reviewIncident,
  closeIncident,
  IncidentError,
} from '@/lib/incident-service';
import { reportSchema, reviewSchema, closeSchema } from '@/lib/validation/incident';
import { fieldErrorsFrom } from '@/lib/validation/site';

export interface IncidentFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: string;
}

export async function report(
  _prev: IncidentFormState,
  formData: FormData,
): Promise<IncidentFormState> {
  const principal = await requirePermission('incident:create');

  const parsed = reportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let created: { id: string; reference: string };
  try {
    created = await reportIncident(principal, parsed.data);
  } catch (error) {
    if (error instanceof IncidentError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'incident.report',
    entityType: 'Incident',
    entityId: created.id,
    after: { reference: created.reference, kind: parsed.data.kind },
  });

  revalidatePath('/incidents');
  redirect('/incidents');
}

/**
 * Record that somebody has looked at it.
 *
 * incident:edit — a supervisor and above. A worker reports; somebody with the
 * wider view grades. See the note in incidents.ts about why the reporter is not
 * asked to.
 */
export async function review(
  incidentId: string,
  _prev: IncidentFormState,
  formData: FormData,
): Promise<IncidentFormState> {
  const principal = await requirePermission('incident:edit');

  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let result: { reference: string };
  try {
    result = await reviewIncident(principal, incidentId, parsed.data);
  } catch (error) {
    if (error instanceof IncidentError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'incident.review',
    entityType: 'Incident',
    entityId: incidentId,
    after: { severity: parsed.data.severity, note: parsed.data.reviewNote },
  });

  revalidatePath('/incidents');
  return {
    ok: `${result.reference} marked as looked at. Whoever reported it can see that now.`,
  };
}

export async function close(
  incidentId: string,
  _prev: IncidentFormState,
  formData: FormData,
): Promise<IncidentFormState> {
  const principal = await requirePermission('incident:approve');

  const parsed = closeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let result: { reference: string };
  try {
    result = await closeIncident(principal, incidentId, parsed.data.outcome);
  } catch (error) {
    if (error instanceof IncidentError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'incident.close',
    entityType: 'Incident',
    entityId: incidentId,
    after: { outcome: parsed.data.outcome },
  });

  revalidatePath('/incidents');
  return { ok: `${result.reference} closed.` };
}
