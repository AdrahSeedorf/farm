'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { recordVisit, signOutVisit, setDowntime, VisitorError } from '@/lib/visitor-service';
import { recordCleaning, setCleaningInterval, CleaningError } from '@/lib/cleaning-service';
import {
  visitorSchema,
  departureSchema,
  downtimeSchema,
  cleaningSchema,
  cleaningIntervalSchema,
} from '@/lib/validation/biosecurity';
import { fieldErrorsFrom } from '@/lib/validation/site';

export interface BiosecurityFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: string;
}

/**
 * Log someone in at the gate.
 *
 * Redirects to the visit itself rather than staying put, because the thing the
 * person wants next is the sentence about downtime — and that sentence belongs
 * beside the whole record, not floating above an empty form.
 */
export async function logVisitor(
  _prev: BiosecurityFormState,
  formData: FormData,
): Promise<BiosecurityFormState> {
  const principal = await requirePermission('biosecurity:create');

  const parsed = visitorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let visitId: string;
  try {
    const result = await recordVisit(principal, parsed.data);
    visitId = result.id;

    await recordAudit({
      principal,
      action: 'visitor.log',
      entityType: 'VisitorLog',
      entityId: result.id,
      after: {
        name: parsed.data.name,
        kind: parsed.data.kind,
        declaration: parsed.data.declaration,
        enteredProductionUnit: parsed.data.enteredProductionUnit,
      },
    });
  } catch (error) {
    if (error instanceof VisitorError) return { error: error.message };
    throw error;
  }

  revalidatePath('/biosecurity');
  redirect(`/biosecurity/visitors/${visitId}`);
}

/** Sign a visitor out. */
export async function signOut(
  visitId: string,
  _prev: BiosecurityFormState,
  formData: FormData,
): Promise<BiosecurityFormState> {
  const principal = await requirePermission('biosecurity:edit');

  const parsed = departureSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  try {
    await signOutVisit(principal, visitId, parsed.data.departedAt);
  } catch (error) {
    if (error instanceof VisitorError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'visitor.signOut',
    entityType: 'VisitorLog',
    entityId: visitId,
    after: { departedAt: parsed.data.departedAt },
  });

  revalidatePath('/biosecurity');
  revalidatePath(`/biosecurity/visitors/${visitId}`);
  return { ok: 'Signed out.' };
}

/**
 * Set or clear a farm's downtime rule.
 *
 * Clearing it is a real choice, not an omission, so a blank saves as null and
 * the visitor log goes back to reporting elapsed time without a verdict.
 */
export async function updateDowntime(
  siteId: string,
  _prev: BiosecurityFormState,
  formData: FormData,
): Promise<BiosecurityFormState> {
  const principal = await requirePermission('site:edit');

  const parsed = downtimeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let changed: { before: number | null; name: string };
  try {
    changed = await setDowntime(principal, siteId, parsed.data.visitorDowntimeHours);
  } catch (error) {
    if (error instanceof VisitorError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'site.update',
    entityType: 'Site',
    entityId: siteId,
    before: { visitorDowntimeHours: changed.before },
    after: { visitorDowntimeHours: parsed.data.visitorDowntimeHours },
  });

  revalidatePath('/biosecurity');
  return {
    ok:
      parsed.data.visitorDowntimeHours === null
        ? `${changed.name} now has no downtime rule. Visits will be recorded without one.`
        : `${changed.name} now asks for ${parsed.data.visitorDowntimeHours} hours.`,
  };
}

// ---------------------------------------------------------------------------
// CLEANING & DISINFECTION
// ---------------------------------------------------------------------------

export interface CleaningFormState extends BiosecurityFormState {
  /** What left the store. Null when nothing did. */
  stockNote?: string | null;
}

/**
 * Record a clean.
 *
 * Stays on the form rather than redirecting. Cleaning is recorded in runs — a
 * dry clean, a wash and a disinfect on the same house over three days, or four
 * houses on one day — and bouncing back to a list after each one means
 * re-choosing the farm and the date every time.
 */
export async function logCleaning(
  _prev: CleaningFormState,
  formData: FormData,
): Promise<CleaningFormState> {
  const principal = await requirePermission('biosecurity:create');

  const parsed = cleaningSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let result: { id: string; stockNote: string | null };
  try {
    result = await recordCleaning(principal, parsed.data);
  } catch (error) {
    if (error instanceof CleaningError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'cleaning.record',
    entityType: 'CleaningRecord',
    entityId: result.id,
    after: {
      scope: parsed.data.scope,
      stage: parsed.data.stage,
      performedOn: parsed.data.performedOn,
    },
  });

  revalidatePath('/biosecurity');
  revalidatePath('/biosecurity/cleaning');
  return { ok: 'Recorded.', stockNote: result.stockNote };
}

/** Set or clear how often a house should be cleaned. */
export async function updateCleaningInterval(
  productionUnitId: string,
  _prev: BiosecurityFormState,
  formData: FormData,
): Promise<BiosecurityFormState> {
  const principal = await requirePermission('site:edit');

  const parsed = cleaningIntervalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let changed: { name: string; before: number | null };
  try {
    changed = await setCleaningInterval(
      principal,
      productionUnitId,
      parsed.data.cleaningIntervalDays,
    );
  } catch (error) {
    if (error instanceof CleaningError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'productionUnit.update',
    entityType: 'ProductionUnit',
    entityId: productionUnitId,
    before: { cleaningIntervalDays: changed.before },
    after: { cleaningIntervalDays: parsed.data.cleaningIntervalDays },
  });

  revalidatePath('/biosecurity/cleaning');
  return {
    ok:
      parsed.data.cleaningIntervalDays === null
        ? `${changed.name} is no longer measured against an interval.`
        : `${changed.name} — every ${parsed.data.cleaningIntervalDays} days.`,
  };
}
