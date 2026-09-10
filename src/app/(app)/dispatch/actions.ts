'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import {
  recordDispatch,
  reverseDispatch,
  dispatchContext,
  DispatchError,
} from '@/lib/dispatch-service';
import {
  dispatchSchema,
  quantitySchema,
  reverseDispatchSchema,
} from '@/lib/validation/dispatch';
import { fieldErrorsFrom } from '@/lib/validation/site';
import type { Warning } from '@/lib/warnings';
import type { DispatchLineInput } from '@/lib/dispatch';

export interface DispatchFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Set when a withdrawal period refused the load. */
  clearsOn?: string;
  /** Shown, then acknowledged with the token, then the same figures save. */
  warnings?: Warning[];
  warningToken?: string;
  ok?: string;
}

/**
 * Record what went out.
 *
 * QUANTITIES ARRIVE AS ONE FIELD PER ORDER LINE — `qty-<lineId>` — because the
 * form is the order with a box beside each line. They are read back against the
 * order rather than trusted from the form: a line id that is not on this order is
 * dropped rather than accepted, so a tampered form cannot attach a load to
 * somebody else's order.
 */
export async function recordLoad(
  orderId: string,
  _prev: DispatchFormState,
  formData: FormData,
): Promise<DispatchFormState> {
  const principal = await requirePermission('delivery:create');

  const parsed = dispatchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const context = await dispatchContext(principal, orderId);
  if (!context) return { error: 'That order no longer exists.' };

  const lines: DispatchLineInput[] = [];
  const fieldErrors: Record<string, string> = {};
  for (const line of context.order.lines) {
    const raw = formData.get(`qty-${line.id}`);
    const quantity = quantitySchema.safeParse(typeof raw === 'string' ? raw : '');
    if (!quantity.success) {
      fieldErrors[`qty-${line.id}`] = 'How many? A number, or leave it blank.';
      continue;
    }
    if (quantity.data === 0) continue;
    lines.push({
      salesOrderLineId: line.id,
      productId: line.productId,
      quantity: quantity.data,
      unitsPerPack: line.unitsPerPack,
    });
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  const result = await recordDispatch(principal, {
    salesOrderId: orderId,
    method: parsed.data.method,
    dispatchedOn: parsed.data.dispatchedOn,
    takenBy: parsed.data.takenBy,
    vehicle: parsed.data.vehicle,
    receivedBy: parsed.data.receivedBy,
    notes: parsed.data.notes,
    lines,
  }, parsed.data.acknowledged);

  if (result.status === 'needsConfirmation') {
    return { warnings: result.warnings, warningToken: result.token };
  }
  if (result.status === 'refused') {
    return {
      error: result.message,
      ...(result.clearsOn ? { clearsOn: result.clearsOn.toISOString().slice(0, 10) } : {}),
    };
  }

  await recordAudit({
    principal,
    action: 'dispatch.record',
    entityType: 'Dispatch',
    entityId: result.id,
    after: {
      reference: result.reference,
      salesOrderId: orderId,
      method: parsed.data.method,
      lines: lines.length,
    },
  });

  revalidatePath('/dispatch');
  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
  revalidatePath('/inventory');
  redirect(`/dispatch/${result.id}`);
}

export async function reverseLoad(
  dispatchId: string,
  _prev: DispatchFormState,
  formData: FormData,
): Promise<DispatchFormState> {
  // `edit`, not `create`: putting stock back is a correction, and the role that
  // records loads is not automatically the role that unwinds them.
  const principal = await requirePermission('delivery:edit');

  const parsed = reverseDispatchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let result;
  try {
    result = await reverseDispatch(principal, dispatchId, parsed.data.reason);
  } catch (error) {
    if (error instanceof DispatchError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'dispatch.reverse',
    entityType: 'Dispatch',
    entityId: dispatchId,
    after: { reason: parsed.data.reason, returnedBase: result.returnedBase },
  });

  revalidatePath('/dispatch');
  revalidatePath(`/dispatch/${dispatchId}`);
  revalidatePath('/orders');
  revalidatePath('/inventory');
  return { ok: `${result.reference} reversed. ${result.returnedBase} went back to the store.` };
}
