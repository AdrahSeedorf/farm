'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import {
  createOrder,
  addLine,
  removeLine,
  setDrawnFrom,
  confirmOrder,
  cancelOrder,
  SalesError,
} from '@/lib/sales-service';
import {
  newOrderSchema,
  lineSchema,
  cancelOrderSchema,
  drawnFromSchema,
} from '@/lib/validation/sales';
import { fieldErrorsFrom } from '@/lib/validation/site';

export interface OrderFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Set when a withdrawal period refused the confirmation. */
  clearsOn?: string;
}

export async function startOrder(
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const principal = await requirePermission('order:create');

  const parsed = newOrderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let result;
  try {
    result = await createOrder(principal, parsed.data);
  } catch (error) {
    if (error instanceof SalesError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'salesOrder.create',
    entityType: 'SalesOrder',
    entityId: result.id,
    after: { orderNumber: result.orderNumber, customerId: parsed.data.customerId },
  });

  revalidatePath('/orders');
  redirect(`/orders/${result.id}`);
}

export async function addOrderLine(
  orderId: string,
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const principal = await requirePermission('order:edit');

  const parsed = lineSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  try {
    const line = await addLine(principal, orderId, {
      productId: parsed.data.productId,
      quantity: parsed.data.quantity,
      pricePesewas: parsed.data.price,
      note: parsed.data.note,
    });
    await recordAudit({
      principal,
      action: 'salesOrder.line.add',
      entityType: 'SalesOrder',
      entityId: orderId,
      after: { lineId: line.id, productId: parsed.data.productId, quantity: parsed.data.quantity },
    });
  } catch (error) {
    if (error instanceof SalesError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/orders/${orderId}`);
  return {};
}

export async function dropOrderLine(
  orderId: string,
  lineId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: OrderFormState,
): Promise<OrderFormState> {
  const principal = await requirePermission('order:edit');
  try {
    await removeLine(principal, orderId, lineId);
    await recordAudit({
      principal,
      action: 'salesOrder.line.remove',
      entityType: 'SalesOrder',
      entityId: orderId,
      after: { lineId },
    });
  } catch (error) {
    if (error instanceof SalesError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/orders/${orderId}`);
  return {};
}

export async function saveDrawnFrom(
  orderId: string,
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const principal = await requirePermission('order:edit');

  const parsed = drawnFromSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  try {
    await setDrawnFrom(principal, orderId, parsed.data.flockId);
    await recordAudit({
      principal,
      action: 'salesOrder.source',
      entityType: 'SalesOrder',
      entityId: orderId,
      after: { drawnFromFlockId: parsed.data.flockId },
    });
  } catch (error) {
    if (error instanceof SalesError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/orders/${orderId}`);
  return {};
}

/**
 * Confirming needs `order:edit`, not `order:approve`.
 *
 * On a farm this size the person who takes the order on the phone is the person
 * who confirms it, and requiring a second pair of hands would mean orders sat in
 * draft until somebody senior was free — which is how a buyer ends up thinking
 * an order was placed when it was not. The record of WHO confirmed it is what
 * makes that safe.
 */
export async function confirm(
  orderId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: OrderFormState,
): Promise<OrderFormState> {
  const principal = await requirePermission('order:edit');
  try {
    const result = await confirmOrder(principal, orderId);
    await recordAudit({
      principal,
      action: 'salesOrder.confirm',
      entityType: 'SalesOrder',
      entityId: orderId,
      after: { orderNumber: result.orderNumber },
    });
  } catch (error) {
    if (error instanceof SalesError) {
      return {
        error: error.message,
        clearsOn: error.clearsOn?.toISOString().slice(0, 10),
      };
    }
    throw error;
  }
  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
  return {};
}

export async function cancel(
  orderId: string,
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const principal = await requirePermission('order:edit');

  const parsed = cancelOrderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  try {
    const result = await cancelOrder(principal, orderId, parsed.data.reason);
    await recordAudit({
      principal,
      action: 'salesOrder.cancel',
      entityType: 'SalesOrder',
      entityId: orderId,
      after: { orderNumber: result.orderNumber, reason: parsed.data.reason },
    });
  } catch (error) {
    if (error instanceof SalesError) return { error: error.message };
    throw error;
  }
  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
  return {};
}
