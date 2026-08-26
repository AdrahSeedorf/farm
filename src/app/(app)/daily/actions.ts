'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { canAccessSite, orgFilter } from '@/lib/scope';
import { AuthorizationError } from '@/lib/rbac';
import { submitDailyRecord } from '@/lib/daily-service';
import { dailyRecordSchema } from '@/lib/validation/daily';
import { fieldErrorsFrom } from '@/lib/validation/site';
import type { Warning } from '@/lib/daily-checks';

export interface DailyFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Shown for confirmation. The submission is NOT saved while these stand. */
  warnings?: Warning[];
}

export async function saveDailyRecord(
  flockId: string,
  _prev: DailyFormState,
  formData: FormData,
): Promise<DailyFormState> {
  const principal = await requirePermission('dailyRecord:create');

  const flock = await db.animalGroup.findFirst({
    where: { id: flockId, site: { ...orgFilter(principal) } },
    select: { id: true, siteId: true, code: true },
  });
  if (!flock) return { error: 'That flock no longer exists.' };
  if (!canAccessSite(principal, flock.siteId)) {
    throw new AuthorizationError('dailyRecord:create', flock.siteId);
  }

  const parsed = dailyRecordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const result = await submitDailyRecord(principal, flockId, parsed.data);

  if (result.status === 'needsConfirmation') return { warnings: result.warnings };
  if (result.status === 'error') return { error: result.message };

  await recordAudit({
    principal,
    action: 'record.correct',
    entityType: 'DailyRecord',
    entityId: result.recordId,
    after: {
      flock: flock.code,
      onDate: parsed.data.onDate.toISOString().slice(0, 10),
      mortality: parsed.data.mortality,
      culls: parsed.data.culls,
      feedKg: parsed.data.feedKg,
      waterLitres: parsed.data.waterLitres,
    },
  });

  revalidatePath('/daily');
  revalidatePath(`/flocks/${flockId}`);
  redirect('/daily?saved=1');
}

/**
 * Supervisor verification.
 *
 * Separate from entry on purpose: the value of a second pair of eyes disappears
 * entirely if the same person can supply both.
 */
export async function verifyDailyRecord(recordId: string): Promise<void> {
  const principal = await requirePermission('dailyRecord:approve');

  const record = await db.dailyRecord.findFirst({
    where: { id: recordId, animalGroup: { site: { ...orgFilter(principal) } } },
    select: { id: true, recordedById: true, verifiedById: true, animalGroup: { select: { siteId: true } } },
  });
  if (!record) return;
  if (!canAccessSite(principal, record.animalGroup.siteId)) {
    throw new AuthorizationError('dailyRecord:approve', record.animalGroup.siteId);
  }
  if (record.verifiedById) return;

  await db.dailyRecord.update({
    where: { id: recordId },
    data: { verifiedById: principal.userId, verifiedAt: new Date() },
  });

  await recordAudit({
    principal,
    action: 'record.correct',
    entityType: 'DailyRecord',
    entityId: recordId,
    after: { verified: true },
  });

  revalidatePath('/daily');
}
