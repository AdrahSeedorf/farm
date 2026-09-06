'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import {
  createOrder,
  updateOrderHeader,
  addOrderLine,
  removeOrderLine,
  markOrderSent,
  cancelOrder,
  OrderError,
} from '@/lib/order-service';
import { receiveAgainstOrder } from '@/lib/order-receipt-service';
import {
  orderHeaderSchema,
  orderLineSchema,
  cancelOrderSchema,
  orderReceiptSchema,
} from '@/lib/validation/purchasing';
import type { Warning } from '@/lib/warnings';
import { fieldErrorsFrom } from '@/lib/validation/site';

export interface OrderFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: string;
}

export interface ReceiveFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Shown for confirmation. NOTHING HAS BEEN WRITTEN while these are present. */
  warnings?: Warning[];
  warningToken?: string;
  saved?: {
    /** Identifies THIS save, so the form clears itself exactly once. */
    movementId: string;
    itemName: string;
    quantity: number;
    unitKey: string;
    batchNumber: string | null;
    stillOutstanding: number;
    orderComplete: boolean;
  };
}

export async function placeOrder(
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const principal = await requirePermission('procurement:create');

  const parsed = orderHeaderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let created: { id: string; orderNumber: string };
  try {
    created = await createOrder(principal, parsed.data);
  } catch (error) {
    if (error instanceof OrderError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'order.create',
    entityType: 'PurchaseOrder',
    entityId: created.id,
    after: { orderNumber: created.orderNumber, state: 'DRAFT' },
  });

  revalidatePath('/purchases');
  redirect(`/purchases/${created.id}`);
}

export async function editOrder(
  orderId: string,
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const principal = await requirePermission('procurement:edit');

  const parsed = orderHeaderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  try {
    await updateOrderHeader(principal, orderId, parsed.data);
  } catch (error) {
    if (error instanceof OrderError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'order.update',
    entityType: 'PurchaseOrder',
    entityId: orderId,
    after: { expectedOn: parsed.data.expectedOn?.toISOString() ?? null },
  });

  revalidatePath(`/purchases/${orderId}`);
  redirect(`/purchases/${orderId}`);
}

export async function addLine(
  orderId: string,
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const principal = await requirePermission('procurement:create');

  const parsed = orderLineSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  try {
    await addOrderLine(principal, orderId, parsed.data);
  } catch (error) {
    if (error instanceof OrderError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'order.line.add',
    entityType: 'PurchaseOrder',
    entityId: orderId,
    after: { itemId: parsed.data.itemId, quantity: parsed.data.quantityOrdered },
  });

  revalidatePath(`/purchases/${orderId}`);
  return { ok: 'Line added.' };
}

export async function dropLine(
  orderId: string,
  lineId: string,
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const principal = await requirePermission('procurement:edit');

  // Stated, not inferred — a double tap on a slow connection must not remove a
  // line somebody re-added in between.
  if (String(formData.get('intent') ?? '') !== 'remove') {
    return { error: 'That action is not recognised.' };
  }

  let itemName: string;
  try {
    itemName = await removeOrderLine(principal, orderId, lineId);
  } catch (error) {
    if (error instanceof OrderError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'order.line.remove',
    entityType: 'PurchaseOrder',
    entityId: orderId,
    before: { itemName },
  });

  revalidatePath(`/purchases/${orderId}`);
  return { ok: `${itemName} removed.` };
}

export async function sendOrder(
  orderId: string,
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const principal = await requirePermission('procurement:edit');

  if (String(formData.get('intent') ?? '') !== 'send') {
    return { error: 'That action is not recognised.' };
  }

  let result: { orderNumber: string };
  try {
    result = await markOrderSent(principal, orderId);
  } catch (error) {
    if (error instanceof OrderError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'order.send',
    entityType: 'PurchaseOrder',
    entityId: orderId,
    after: { state: 'SENT' },
  });

  revalidatePath('/purchases');
  revalidatePath(`/purchases/${orderId}`);
  return { ok: `${result.orderNumber} marked as sent. Its lines are now fixed.` };
}

export async function killOrder(
  orderId: string,
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const principal = await requirePermission('procurement:edit');

  const parsed = cancelOrderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let result: { orderNumber: string };
  try {
    result = await cancelOrder(principal, orderId, parsed.data.cancelReason);
  } catch (error) {
    if (error instanceof OrderError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'order.cancel',
    entityType: 'PurchaseOrder',
    entityId: orderId,
    after: { state: 'CANCELLED', reason: parsed.data.cancelReason },
  });

  revalidatePath('/purchases');
  revalidatePath(`/purchases/${orderId}`);
  return { ok: `${result.orderNumber} cancelled. It stays on the record.` };
}

/**
 * Record a delivery against a line on this order.
 *
 * Deliberately does NOT redirect. A lorry brings several lines at once, and
 * bouncing back to the order after each one means re-choosing the store and the
 * date every time — which is how the wrong store gets chosen.
 */
export async function receiveDelivery(
  orderId: string,
  _prev: ReceiveFormState,
  formData: FormData,
): Promise<ReceiveFormState> {
  const principal = await requirePermission('inventory:create');

  const parsed = orderReceiptSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const result = await receiveAgainstOrder(principal, orderId, parsed.data);

  if (result.status === 'needsConfirmation') {
    return { warnings: result.warnings, warningToken: result.token };
  }
  if (result.status === 'error') return { error: result.message };

  revalidatePath('/purchases');
  revalidatePath(`/purchases/${orderId}`);
  revalidatePath(`/purchases/${orderId}/receive`);
  revalidatePath('/inventory');

  return {
    saved: {
      movementId: result.movementId,
      itemName: result.itemName,
      quantity: result.quantity,
      unitKey: result.unitKey,
      batchNumber: result.batchNumber,
      stillOutstanding: result.stillOutstanding,
      orderComplete: result.orderComplete,
    },
  };
}
