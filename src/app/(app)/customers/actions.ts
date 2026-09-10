'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import {
  createCustomer,
  updateCustomer,
  archiveCustomer,
  restoreCustomer,
  customerFromEnquiry,
  CustomerError,
} from '@/lib/customer-service';
import { customerSchema, archiveCustomerSchema } from '@/lib/validation/customer';
import { fieldErrorsFrom } from '@/lib/validation/site';

export interface CustomerFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: string;
  /**
   * Somebody with this number was already on the list.
   *
   * CARRIED BACK TO THE FORM RATHER THAN THROWN. The row is saved either way —
   * see customer-service.ts — so this is information, not a failure, and the
   * page renders it as a link to whoever already holds the number.
   */
  duplicateOf?: { customerId: string; message: string };
}

export async function saveCustomer(
  customerId: string | null,
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const principal = await requirePermission(customerId ? 'customer:edit' : 'customer:create');

  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let result;
  try {
    result = customerId
      ? await updateCustomer(principal, customerId, parsed.data)
      : await createCustomer(principal, parsed.data);
  } catch (error) {
    if (error instanceof CustomerError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: customerId ? 'customer.update' : 'customer.create',
    entityType: 'Customer',
    entityId: result.id,
    after: { name: parsed.data.name, phone: parsed.data.phone, kind: parsed.data.kind },
  });

  revalidatePath('/customers');

  // A DUPLICATE KEEPS THE PERSON ON THE FORM so they can read the warning and
  // decide. Redirecting away would save the row and hide the one thing they
  // needed to know about it.
  if (result.warning) {
    return { ok: 'Saved.', duplicateOf: result.warning };
  }

  redirect(`/customers/${result.id}`);
}

export async function archive(
  customerId: string,
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const principal = await requirePermission('customer:edit');

  const parsed = archiveCustomerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  try {
    const result = await archiveCustomer(principal, customerId, parsed.data.reason);
    await recordAudit({
      principal,
      action: 'customer.archive',
      entityType: 'Customer',
      entityId: customerId,
      after: { name: result.name, reason: parsed.data.reason },
    });
  } catch (error) {
    if (error instanceof CustomerError) return { error: error.message };
    throw error;
  }

  revalidatePath('/customers');
  return {};
}

export async function restore(
  customerId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: CustomerFormState,
): Promise<CustomerFormState> {
  const principal = await requirePermission('customer:edit');

  try {
    const result = await restoreCustomer(principal, customerId);
    await recordAudit({
      principal,
      action: 'customer.restore',
      entityType: 'Customer',
      entityId: customerId,
      after: { name: result.name },
    });
  } catch (error) {
    if (error instanceof CustomerError) return { error: error.message };
    throw error;
  }

  revalidatePath('/customers');
  return {};
}

/**
 * Turn an enquiry into a buyer.
 *
 * Needs `customer:create` rather than `customer:edit` — it makes a customer, and
 * the fact that the details came from an enquiry does not make it a smaller act.
 */
export async function convertEnquiry(
  enquiryId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: CustomerFormState,
): Promise<CustomerFormState> {
  const principal = await requirePermission('customer:create');

  let result;
  try {
    result = await customerFromEnquiry(principal, enquiryId);
  } catch (error) {
    if (error instanceof CustomerError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'customer.create',
    entityType: 'Customer',
    entityId: result.id,
    after: { fromEnquiryId: enquiryId },
  });

  revalidatePath('/customers');
  revalidatePath('/enquiries');
  redirect(`/customers/${result.id}`);
}
