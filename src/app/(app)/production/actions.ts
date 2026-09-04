'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { canAccessSite, orgFilter } from '@/lib/scope';
import { AuthorizationError } from '@/lib/rbac';
import { submitCollection, correctCollection } from '@/lib/production-service';
import {
  collectionSchema,
  countedToBase,
  parseGradeLines,
  type CountingUnit,
} from '@/lib/validation/production';
import { fieldErrorsFrom } from '@/lib/validation/site';
import type { Warning } from '@/lib/warnings';

export interface CollectionFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Shown for confirmation. Nothing is saved while these stand. */
  warnings?: Warning[];
  /** Fingerprint of those warnings — acceptance covers only them. */
  warningToken?: string;
  /** Set on success, so the form knows to clear itself for the next round. */
  saved?: {
    sequence: number;
    total: number;
    /** What happened in the store — including when the answer is "nothing, because…". */
    stock: string;
  };
}

/**
 * Record one collection.
 *
 * The four steps in the same order as everywhere else: authorise, validate,
 * write, audit. Authorising first means an unauthorised caller never learns
 * which fields exist or which grades this farm uses.
 */
export async function saveCollection(
  flockId: string,
  _prev: CollectionFormState,
  formData: FormData,
): Promise<CollectionFormState> {
  const principal = await requirePermission('production:create');

  const flock = await db.animalGroup.findFirst({
    where: { id: flockId, site: orgFilter(principal) },
    select: {
      id: true,
      siteId: true,
      code: true,
      productionType: {
        select: {
          productionGrades: { where: { isActive: true }, select: { id: true } },
        },
      },
    },
  });
  if (!flock) return { error: 'That flock no longer exists.' };
  if (!canAccessSite(principal, flock.siteId)) {
    throw new AuthorizationError('production:create', flock.siteId);
  }

  const parsed = collectionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const input = parsed.data;

  // The per-grade boxes cannot be named in a static schema — the grade list is
  // configuration. Only ids this farm currently offers are read, so a
  // hand-crafted post naming a retired grade, or one belonging to another farm,
  // is ignored rather than trusted.
  const offered = flock.productionType.productionGrades.map((g) => g.id);
  const graded = parseGradeLines(formData, offered, input.unit as CountingUnit);

  const counted = countedToBase(input.counted, input.unit as CountingUnit);
  const fieldErrors = {
    ...graded.fieldErrors,
    ...(counted.error ? { counted: counted.error } : {}),
  };
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  const result = await submitCollection(principal, flockId, {
    ...input,
    lines: graded.lines,
    countedBase: counted.base,
  });

  if (result.status === 'needsConfirmation') {
    return { warnings: result.warnings, warningToken: result.token };
  }
  if (result.status === 'error') return { error: result.message };

  const total =
    counted.base ?? graded.lines.reduce((sum, line) => sum + line.quantityBase, 0);

  await recordAudit({
    principal,
    action: 'production.record',
    entityType: 'ProductionRecord',
    entityId: result.recordId,
    after: {
      flock: flock.code,
      onDate: input.onDate.toISOString().slice(0, 10),
      sequence: result.sequence,
      total,
      disposition: input.disposition,
    },
  });

  revalidatePath('/production');
  revalidatePath(`/production/${flockId}`);
  revalidatePath(`/flocks/${flockId}`);

  // Deliberately NOT a redirect. A house is walked two or three times a day, and
  // the person recording the second collection is standing where they recorded
  // the first. Staying put shows them what they just entered and leaves the form
  // ready for the next one.
  return { saved: { sequence: result.sequence, total, stock: result.stockNote } };
}

/**
 * Correct a collection that was recorded wrongly.
 *
 * Never an edit. The original stays exactly as it was reported and a reversal
 * row is added beside it, so the day's figure comes out right and the mistake
 * stays visible — which is what makes the corrected figure believable.
 */
export async function correctRecord(
  recordId: string,
  _prev: CollectionFormState,
  formData: FormData,
): Promise<CollectionFormState> {
  const principal = await requirePermission('production:edit');

  const record = await db.productionRecord.findFirst({
    where: { id: recordId, animalGroup: { site: orgFilter(principal) } },
    select: { id: true, animalGroupId: true, animalGroup: { select: { siteId: true } } },
  });
  if (!record) return { error: 'That collection no longer exists.' };
  if (!canAccessSite(principal, record.animalGroup.siteId)) {
    throw new AuthorizationError('production:edit', record.animalGroup.siteId);
  }

  const reason = String(formData.get('reason') ?? '').trim();
  if (reason.length < 4) {
    return {
      fieldErrors: {
        reason: 'Say what was wrong. A correction with no reason is unreadable in six months.',
      },
    };
  }

  const result = await correctCollection(principal, recordId, reason.slice(0, 200));
  if (result.status === 'error') return { error: result.message };

  await recordAudit({
    principal,
    action: 'production.correct',
    entityType: 'ProductionRecord',
    entityId: result.recordId,
    after: { corrects: recordId, reason },
  });

  revalidatePath('/production');
  revalidatePath(`/production/${record.animalGroupId}`);
  return {
    saved: {
      sequence: 0,
      total: 0,
      stock: result.stockNote ?? 'The store has been put back as it was.',
    },
  };
}
