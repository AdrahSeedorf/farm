'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { fieldErrorsFrom } from '@/lib/validation/site';
import {
  farmAlertSchema,
  recordHourSchema,
  stageThresholdSchema,
} from '@/lib/validation/alert-settings';

export interface ThresholdFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: string;
}

/**
 * The farm-wide mortality figures.
 *
 * GUARDED ON `health:approve`, NOT `settings:manage`, and that is the point of
 * this screen. How much death is ordinary is a veterinary judgement, and the vet
 * role holds no settings permission at all — so putting these behind the
 * settings gate would have meant the person best placed to set them could not,
 * and the owner would be typing in numbers read to them over the phone. The farm
 * administration below stays with the owner; this does not.
 */
export async function updateFarmMortality(
  _prev: ThresholdFormState,
  formData: FormData,
): Promise<ThresholdFormState> {
  const principal = await requirePermission('health:approve');

  const parsed = farmAlertSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const before = await db.organisation.findUnique({
    where: { id: principal.organisationId },
    select: {
      mortalityAttentionPct: true,
      mortalityCriticalPct: true,
      mortalitySpikeMultiple: true,
      mortalitySpikeFloorDeaths: true,
    },
  });
  if (!before) return { error: 'Organisation not found.' };

  const after = await db.organisation.update({
    where: { id: principal.organisationId },
    data: parsed.data,
    select: {
      mortalityAttentionPct: true,
      mortalityCriticalPct: true,
      mortalitySpikeMultiple: true,
      mortalitySpikeFloorDeaths: true,
    },
  });

  // AUDITED, because changing a threshold changes what the farm is told. A
  // figure quietly raised in March is the reason nobody was warned in April, and
  // the log is the only way to find that out afterwards.
  await recordAudit({
    principal,
    action: 'alertThreshold.update',
    entityType: 'Organisation',
    entityId: principal.organisationId,
    before,
    after,
  });

  revalidatePath('/settings/alerts');
  revalidatePath('/alerts');
  return { ok: 'Saved. New alerts are judged against these from now on.' };
}

/**
 * One lifecycle stage's figures.
 *
 * The stage is reached through the production type and species, both of which
 * belong to the organisation — so the update is scoped by that chain rather than
 * by a column the row does not have. A stage id from another farm matches
 * nothing and reports as not found.
 */
export async function updateStageMortality(
  _prev: ThresholdFormState,
  formData: FormData,
): Promise<ThresholdFormState> {
  const principal = await requirePermission('health:approve');

  const parsed = stageThresholdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const stage = await db.lifecycleStage.findFirst({
    where: {
      id: parsed.data.stageId,
      productionType: { speciesProfile: { organisationId: principal.organisationId } },
    },
    select: {
      id: true,
      name: true,
      mortalityAttentionPct: true,
      mortalityCriticalPct: true,
    },
  });
  if (!stage) return { error: 'That stage no longer exists.' };

  const after = await db.lifecycleStage.update({
    where: { id: stage.id },
    data: {
      mortalityAttentionPct: parsed.data.attentionPct,
      mortalityCriticalPct: parsed.data.criticalPct,
    },
    select: { mortalityAttentionPct: true, mortalityCriticalPct: true },
  });

  await recordAudit({
    principal,
    action: 'alertThreshold.update',
    entityType: 'LifecycleStage',
    entityId: stage.id,
    before: {
      stage: stage.name,
      attentionPct: stage.mortalityAttentionPct,
      criticalPct: stage.mortalityCriticalPct,
    },
    after: { stage: stage.name, ...after },
  });

  revalidatePath('/settings/alerts');
  revalidatePath('/alerts');
  return {
    ok:
      parsed.data.attentionPct === null && parsed.data.criticalPct === null
        ? `${stage.name} now uses the farm figures.`
        : `${stage.name} saved.`,
  };
}

/**
 * When a missing daily record becomes worth mentioning.
 *
 * Farm administration rather than veterinary judgement, so this one stays with
 * whoever runs the business.
 */
export async function updateRecordHour(
  _prev: ThresholdFormState,
  formData: FormData,
): Promise<ThresholdFormState> {
  const principal = await requirePermission('settings:manage');

  const parsed = recordHourSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const before = await db.organisation.findUnique({
    where: { id: principal.organisationId },
    select: { recordDueHour: true },
  });
  if (!before) return { error: 'Organisation not found.' };

  const after = await db.organisation.update({
    where: { id: principal.organisationId },
    data: parsed.data,
    select: { recordDueHour: true },
  });

  await recordAudit({
    principal,
    action: 'alertThreshold.update',
    entityType: 'Organisation',
    entityId: principal.organisationId,
    before,
    after,
  });

  revalidatePath('/settings/alerts');
  revalidatePath('/alerts');
  return { ok: `Saved. Records are due by ${after.recordDueHour}:00.` };
}
