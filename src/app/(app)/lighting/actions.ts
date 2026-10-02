'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import {
  LightingError,
  makeDefault,
  removeStep,
  saveStep,
  setSupplementMode,
  startDraftLighting,
} from '@/lib/lighting-service';
import { modeSchema, stepSchema } from '@/lib/validation/lighting';
import { fieldErrorsFrom } from '@/lib/validation/site';
import type { Warning } from '@/lib/warnings';

export interface LightingFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  warnings?: Warning[];
  warningToken?: string;
  ok?: string;
}

/**
 * Start the shipped draft.
 *
 * `flock:edit` RATHER THAN `health:edit`. Daylength is husbandry, not medicine —
 * nothing here is administered to an animal and no veterinary judgement is
 * involved. The person who runs the house is the person who sets the lights.
 */
export async function startDraft(): Promise<void> {
  const principal = await requirePermission('flock:edit');
  const { id, created } = await startDraftLighting(principal);

  if (created) {
    await recordAudit({
      principal,
      action: 'lighting.start',
      entityType: 'LightingProgramme',
      entityId: id,
      after: { source: 'shipped draft' },
    });
  }

  revalidatePath('/lighting');
  redirect(`/lighting/${id}`);
}

export async function saveLightingStep(
  _prev: LightingFormState,
  formData: FormData,
): Promise<LightingFormState> {
  const principal = await requirePermission('flock:edit');

  const parsed = stepSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const result = await saveStep(
    principal,
    {
      programmeId: parsed.data.programmeId,
      ageDays: parsed.data.ageDays,
      totalHours: parsed.data.totalHours,
      lux: parsed.data.lux,
      note: parsed.data.note,
    },
    parsed.data.acknowledged,
  );

  if (result.status === 'needsConfirmation') {
    return { warnings: result.warnings, warningToken: result.token };
  }
  if (result.status === 'refused') return { error: result.message };

  await recordAudit({
    principal,
    action: 'lighting.step.save',
    entityType: 'LightingStep',
    entityId: result.id,
    after: {
      programmeId: parsed.data.programmeId,
      ageDays: parsed.data.ageDays,
      totalHours: parsed.data.totalHours,
      lux: parsed.data.lux,
    },
  });

  revalidatePath('/lighting');
  revalidatePath(`/lighting/${parsed.data.programmeId}`);
  return { ok: `Day ${parsed.data.ageDays} saved.` };
}

export async function deleteLightingStep(
  stepId: string,
  programmeId: string,
): Promise<LightingFormState> {
  const principal = await requirePermission('flock:edit');

  try {
    await removeStep(principal, stepId);
  } catch (error) {
    if (error instanceof LightingError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'lighting.step.remove',
    entityType: 'LightingStep',
    entityId: stepId,
    before: { programmeId },
  });

  revalidatePath('/lighting');
  revalidatePath(`/lighting/${programmeId}`);
  return { ok: 'Step removed.' };
}

export async function changeSupplementMode(
  _prev: LightingFormState,
  formData: FormData,
): Promise<LightingFormState> {
  const principal = await requirePermission('flock:edit');

  const parsed = modeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  try {
    await setSupplementMode(principal, parsed.data.programmeId, parsed.data.mode);
  } catch (error) {
    if (error instanceof LightingError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'lighting.mode',
    entityType: 'LightingProgramme',
    entityId: parsed.data.programmeId,
    after: { supplementMode: parsed.data.mode },
  });

  revalidatePath('/lighting');
  revalidatePath(`/lighting/${parsed.data.programmeId}`);
  return { ok: 'Saved. The switch-on times below have moved.' };
}

export async function useThisProgramme(programmeId: string): Promise<void> {
  const principal = await requirePermission('flock:edit');
  await makeDefault(principal, programmeId);

  await recordAudit({
    principal,
    action: 'lighting.default',
    entityType: 'LightingProgramme',
    entityId: programmeId,
    after: { isDefault: true },
  });

  revalidatePath('/lighting');
  revalidatePath(`/lighting/${programmeId}`);
}
