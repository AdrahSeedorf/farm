'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/session';
import { submitReceipt } from '@/lib/receipt-service';
import { receiptSchema } from '@/lib/validation/receipt';
import { fieldErrorsFrom } from '@/lib/validation/site';
import { fromBase } from '@/lib/uom';
import type { Warning } from '@/lib/warnings';

export interface ReceiptFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Shown for confirmation. Nothing has been written while these are present. */
  warnings?: Warning[];
  warningToken?: string;
  saved?: {
    /** Identifies THIS save, so the form can clear itself exactly once. */
    movementId: string;
    itemId: string;
    itemName: string;
    batchNumber: string | null;
    /** On hand at that store afterwards, in the item's own unit. */
    onHand: number;
    unitKey: string;
  };
}

/**
 * Record a delivery.
 *
 * Deliberately does NOT redirect on success. Deliveries arrive several at a
 * time, and bouncing the storekeeper back to a list after every line means
 * re-selecting the store and the date for each one. The form stays put, confirms
 * what was recorded, and clears the fields that change between lines.
 */
export async function receiveStock(
  _prev: ReceiptFormState,
  formData: FormData,
): Promise<ReceiptFormState> {
  const principal = await requirePermission('inventory:create');

  const parsed = receiptSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const result = await submitReceipt(principal, parsed.data);

  if (result.status === 'needsConfirmation') {
    return { warnings: result.warnings, warningToken: result.token };
  }
  if (result.status === 'error') {
    return { error: result.message };
  }

  revalidatePath('/inventory');
  revalidatePath(`/inventory/${result.itemId}`);

  return {
    saved: {
      movementId: result.movementId,
      itemId: result.itemId,
      itemName: result.itemName,
      batchNumber: result.batchNumber,
      onHand: fromBase(result.onHandBase, result.unitKey),
      unitKey: result.unitKey,
    },
  };
}
