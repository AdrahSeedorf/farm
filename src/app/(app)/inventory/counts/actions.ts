'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { recordStockTake, type SubmittedLine } from '@/lib/stock-take-service';
import { stockTakeHeaderSchema, parseCount } from '@/lib/validation/stock-take';
import { fieldErrorsFrom } from '@/lib/validation/site';
import type { Warning } from '@/lib/warnings';

export interface StockTakeFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  warnings?: Warning[];
  warningToken?: string;
}

/**
 * Save a count.
 *
 * REDIRECTS TO THE COUNT ON SUCCESS, unlike the payment form which stays put. A
 * payment is one of many taken in a row at a counter; a stock take is a single
 * deliberate act, and what the person wants next is to look at what it found —
 * particularly the lines that were out.
 *
 * THE ITEM LIST COMES FROM THE FORM AND IS NOT TRUSTED. Every id is checked
 * against the organisation's own items in the service before anything is read
 * from it, and an id that is not on that list refuses the whole save rather than
 * being skipped — a sheet half-saved is worse than one not saved.
 */
export async function saveStockTake(
  _prev: StockTakeFormState,
  formData: FormData,
): Promise<StockTakeFormState> {
  const principal = await requirePermission('inventory:create');

  const parsed = stockTakeHeaderSchema.safeParse({
    stockLocationId: formData.get('stockLocationId'),
    countedOn: formData.get('countedOn'),
    notes: formData.get('notes'),
    acknowledged: formData.get('acknowledged'),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const itemIds = formData.getAll('itemId').filter((v): v is string => typeof v === 'string');
  if (itemIds.length === 0) return { error: 'That sheet had nothing on it.' };

  const fieldErrors: Record<string, string> = {};
  const lines: SubmittedLine[] = [];

  for (const itemId of itemIds) {
    const counted = parseCount(formData.get(`count-${itemId}`));
    if (counted === 'invalid') {
      fieldErrors[`count-${itemId}`] = 'Write a number, or leave it blank if you did not count it.';
      continue;
    }
    if (counted === null) continue;

    const shown = parseCount(formData.get(`expected-${itemId}`));
    const cause = formData.get(`cause-${itemId}`);
    const note = formData.get(`note-${itemId}`);

    lines.push({
      itemId,
      countedEntered: counted,
      shownExpectedEntered: typeof shown === 'number' ? shown : 0,
      cause: typeof cause === 'string' && cause.trim() !== '' ? cause.trim() : null,
      note: typeof note === 'string' && note.trim() !== '' ? note.trim().slice(0, 300) : null,
    });
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };
  if (lines.length === 0) {
    return { error: 'Nothing has been counted yet. Put a number against at least one thing.' };
  }

  const result = await recordStockTake(
    principal,
    {
      stockLocationId: parsed.data.stockLocationId,
      countedOn: parsed.data.countedOn,
      notes: parsed.data.notes,
      lines,
    },
    parsed.data.acknowledged,
  );

  if (result.status === 'needsConfirmation') {
    return { warnings: result.warnings, warningToken: result.token };
  }
  if (result.status === 'refused') return { error: result.message };

  await recordAudit({
    principal,
    action: 'stockTake.record',
    entityType: 'StockTake',
    entityId: result.id,
    after: {
      reference: result.reference,
      stockLocationId: parsed.data.stockLocationId,
      countedOn: parsed.data.countedOn.toISOString().slice(0, 10),
      counted: result.counted,
      corrected: result.corrected,
    },
  });

  revalidatePath('/inventory');
  revalidatePath('/inventory/counts');
  revalidatePath('/reports');

  redirect(`/inventory/counts/${result.id}`);
}
