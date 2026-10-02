'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import {
  BreedStandardsError,
  clearStandard,
  saveStandard,
} from '@/lib/breed-standards-service';
import { kindLabel, previewSentence, type TablePreview } from '@/lib/standards';
import { standardTableSchema, clearStandardSchema } from '@/lib/validation/standards';
import { fieldErrorsFrom } from '@/lib/validation/site';
import type { Warning } from '@/lib/warnings';

export interface StandardFormState {
  error?: string;
  errors?: string[];
  fieldErrors?: Record<string, string>;
  warnings?: Warning[];
  warningToken?: string;
  /** What was read, so the person can look at it before agreeing. */
  preview?: { sentence: string; kind: string | null; points: number };
  ok?: string;
}

function shape(preview: TablePreview): StandardFormState['preview'] {
  return {
    sentence: previewSentence(preview),
    kind: preview.kind,
    points: preview.points.length,
  };
}

/**
 * Save a table pasted out of a breeder's management guide.
 *
 * `settings:edit`. A breed standard is reference data for the whole farm — every
 * flock of that breed is judged against it — so it sits with the other settings
 * rather than with the day-to-day records.
 *
 * ALWAYS TWO SUBMITS, and deliberately so. The first reads the table and says
 * what kind it thinks it is; the second saves. The detected kind is the one
 * interpretation nothing downstream can check, because a lay curve in the weight
 * column produces numbers that look plausible. Everywhere else in this system a
 * confirmation appears only when something looks wrong; here it appears every
 * time.
 */
export async function saveBreedStandard(
  _prev: StandardFormState,
  formData: FormData,
): Promise<StandardFormState> {
  const principal = await requirePermission('settings:edit');

  const parsed = standardTableSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const result = await saveStandard(
    principal,
    {
      breedId: parsed.data.breedId,
      table: parsed.data.table,
      kindOverride: parsed.data.kind,
      sourceNote: parsed.data.sourceNote,
    },
    parsed.data.acknowledged,
  );

  if (result.status === 'refused') {
    return { errors: result.messages, preview: shape(result.preview) };
  }
  if (result.status === 'needsConfirmation') {
    return {
      warnings: result.warnings,
      warningToken: result.token,
      preview: shape(result.preview),
    };
  }

  await recordAudit({
    principal,
    action: 'breedStandard.load',
    entityType: 'Breed',
    entityId: parsed.data.breedId,
    after: { kind: result.kind, points: result.points, source: parsed.data.sourceNote },
  });

  revalidatePath('/settings/breeds');
  revalidatePath('/flocks');
  revalidatePath('/production');

  return {
    ok: `${result.points} points saved as ${result.breedName}'s ${kindLabel(
      result.kind,
    )}. Flocks of this breed now compare against it.`,
  };
}

/**
 * Take a table back off a breed.
 *
 * A REAL DELETE, which is the exception in this system and is right here: a
 * standard is not a record of anything that happened. It is reference data
 * copied out of a book, and the fix for the wrong book is to remove it. The
 * screens go back to reporting no comparison, which is true.
 */
export async function removeBreedStandard(
  _prev: StandardFormState,
  formData: FormData,
): Promise<StandardFormState> {
  const principal = await requirePermission('settings:edit');

  const parsed = clearStandardSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let result;
  try {
    result = await clearStandard(principal, parsed.data.breedId, parsed.data.kind);
  } catch (error) {
    if (error instanceof BreedStandardsError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'breedStandard.clear',
    entityType: 'Breed',
    entityId: parsed.data.breedId,
    before: { kind: parsed.data.kind },
  });

  revalidatePath('/settings/breeds');
  revalidatePath('/flocks');
  revalidatePath('/production');

  return {
    ok: `${result.breedName}'s ${kindLabel(
      parsed.data.kind,
    )} removed. Flocks of this breed no longer compare against anything.`,
  };
}
