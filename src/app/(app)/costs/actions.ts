'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import {
  allocationCandidates,
  recordAllocation,
  reverseAllocation,
  CostError,
} from '@/lib/cost-service';
import {
  allocationErrors,
  checkAllocation,
  allocationSentence,
  methodNeedsPeriod,
  type AllocationTarget,
} from '@/lib/cost-allocation';
import {
  allocationSchema,
  reversalSchema,
  parseManualShares,
  parseSelectedFlocks,
} from '@/lib/validation/cost';
import { fieldErrorsFrom } from '@/lib/validation/site';
import { warningToken, type Warning } from '@/lib/warnings';

export interface CostFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Shown for confirmation. Nothing has been written while these are present. */
  warnings?: Warning[];
  warningToken?: string;
}

/**
 * Record a cost and divide it between flocks.
 *
 * THE WEIGHTS ARE RECOMPUTED HERE, from the ledger, and the ones the browser
 * sent are ignored entirely. The form shows a live preview so the person can
 * see what each method does before committing, and that preview is convenience
 * — it arrives back as numbers anyone could edit. What gets written is what the
 * server works out for itself.
 */
export async function recordCost(
  _prev: CostFormState,
  formData: FormData,
): Promise<CostFormState> {
  const principal = await requirePermission('finance:create');

  const parsed = allocationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const input = parsed.data;

  const flockIds = parseSelectedFlocks(formData);
  const shares = parseManualShares(formData);

  // A share that could not be read must not become zero. Silently charging a
  // flock nothing because someone typed "4OO" would be discovered, if ever,
  // when the flock closed and the numbers did not add up.
  if (input.method === 'MANUAL') {
    const unreadable = flockIds.filter((id) => shares[id] === null);
    if (unreadable.length > 0) {
      return { fieldErrors: { method: 'One of the shares is not a readable amount.' } };
    }
  }

  const periodStart = input.periodStart ?? input.incurredOn;
  const periodEnd = input.periodEnd ?? input.incurredOn;

  const candidates = await allocationCandidates(principal, {
    periodStart,
    periodEnd,
    onDate: input.incurredOn,
  });

  const byId = new Map(candidates.map((c) => [c.flockId, c]));
  const targets: AllocationTarget[] = flockIds.map((id) => {
    const c = byId.get(id);
    return {
      flockId: id,
      label: c?.label ?? id,
      birdDays: c?.birdDays ?? 0,
      headcount: c?.headcount ?? 0,
      manualPesewas: shares[id] ?? 0,
    };
  });

  const check = {
    category: input.category,
    totalPesewas: input.amount,
    method: input.method,
    targets,
    periodStart: methodNeedsPeriod(input.method) ? periodStart : null,
    periodEnd: methodNeedsPeriod(input.method) ? periodEnd : null,
  };

  const errors = allocationErrors(check);
  if (errors.length > 0) return { error: errors.join(' ') };

  const warnings = checkAllocation(check);
  const token = warningToken(warnings);
  if (warnings.length > 0 && formData.get('acknowledgedToken') !== token) {
    return { warnings, warningToken: token };
  }

  let allocationId: string;
  try {
    const result = await recordAllocation(principal, {
      category: input.category,
      totalPesewas: input.amount,
      incurredOn: input.incurredOn,
      description: input.description,
      reference: input.reference,
      method: input.method,
      periodStart: methodNeedsPeriod(input.method) ? periodStart : null,
      periodEnd: methodNeedsPeriod(input.method) ? periodEnd : null,
      targets,
    });
    allocationId = result.allocationId;

    await recordAudit({
      principal,
      action: 'cost.allocate',
      entityType: 'CostAllocation',
      entityId: result.allocationId,
      after: {
        description: input.description,
        amountPesewas: input.amount,
        summary: allocationSentence(input.amount, input.method, result.lines),
      },
    });
  } catch (error) {
    if (error instanceof CostError) return { error: error.message };
    throw error;
  }

  revalidatePath('/costs');
  for (const t of targets) revalidatePath(`/flocks/${t.flockId}`);
  redirect(`/costs/${allocationId}`);
}

/**
 * Reverse a cost.
 *
 * Nothing is deleted; see reverseAllocation. The reason is required and is kept
 * on the record, because "why is there a GHS 480 credit in August" is a question
 * the reversal itself should answer.
 */
export async function reverseCost(
  allocationId: string,
  _prev: CostFormState,
  formData: FormData,
): Promise<CostFormState> {
  const principal = await requirePermission('finance:edit');

  const parsed = reversalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let reversalId: string;
  try {
    reversalId = await reverseAllocation(principal, allocationId, parsed.data.reason);
  } catch (error) {
    if (error instanceof CostError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'cost.reverse',
    entityType: 'CostAllocation',
    entityId: allocationId,
    after: { reversalId, reason: parsed.data.reason },
  });

  revalidatePath('/costs');
  revalidatePath(`/costs/${allocationId}`);
  redirect(`/costs/${reversalId}`);
}
