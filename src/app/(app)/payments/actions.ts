'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { recordPayment, reversePayment, PaymentError } from '@/lib/payment-service';
import { paymentSchema, reversePaymentSchema } from '@/lib/validation/payment';
import { fieldErrorsFrom } from '@/lib/validation/site';
import { balanceSentence } from '@/lib/payments';
import type { Warning } from '@/lib/warnings';

export interface PaymentFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  warnings?: Warning[];
  warningToken?: string;
  ok?: string;
}

/**
 * Record money arriving.
 *
 * DELIBERATELY DOES NOT REDIRECT. A buyer settling three loads at the counter
 * pays once, and the person taking it wants to see the balance move and then
 * hand over a receipt — not be thrown onto another page. The new balance comes
 * back in the message.
 */
export async function receivePayment(
  _prev: PaymentFormState,
  formData: FormData,
): Promise<PaymentFormState> {
  const principal = await requirePermission('payment:create');

  const parsed = paymentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const result = await recordPayment(
    principal,
    {
      customerId: parsed.data.customerId,
      amountPesewas: parsed.data.amount,
      method: parsed.data.method,
      receivedOn: parsed.data.receivedOn,
      receivedBy: parsed.data.receivedBy,
      externalRef: parsed.data.externalRef,
      notes: parsed.data.notes,
    },
    parsed.data.acknowledged,
  );

  if (result.status === 'needsConfirmation') {
    return { warnings: result.warnings, warningToken: result.token };
  }
  if (result.status === 'refused') return { error: result.message };

  await recordAudit({
    principal,
    action: 'payment.record',
    entityType: 'Payment',
    entityId: result.id,
    after: {
      reference: result.reference,
      customerId: parsed.data.customerId,
      method: parsed.data.method,
      amountPesewas: parsed.data.amount,
    },
  });

  revalidatePath('/payments');
  revalidatePath('/customers');
  revalidatePath(`/customers/${parsed.data.customerId}`);

  return { ok: `${result.reference} recorded. ${balanceSentence(result.balance)}` };
}

export async function undoPayment(
  paymentId: string,
  _prev: PaymentFormState,
  formData: FormData,
): Promise<PaymentFormState> {
  // `edit`, not `create`: taking money back off the books is a correction, and
  // the role that receives payments is not automatically the one that unwinds
  // them. Sales holds create and not edit.
  const principal = await requirePermission('payment:edit');

  const parsed = reversePaymentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let result;
  try {
    result = await reversePayment(principal, paymentId, parsed.data.reason);
  } catch (error) {
    if (error instanceof PaymentError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'payment.reverse',
    entityType: 'Payment',
    entityId: paymentId,
    after: { reason: parsed.data.reason },
  });

  revalidatePath('/payments');
  revalidatePath('/customers');

  return { ok: `${result.reference} reversed. ${balanceSentence(result.balance)}` };
}
