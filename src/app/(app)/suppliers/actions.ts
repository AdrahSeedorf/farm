'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import {
  createSupplier,
  updateSupplier,
  setSupplierActive,
  SupplierError,
} from '@/lib/supplier-service';
import { supplierSchema, parseSupplies } from '@/lib/validation/purchasing';
import { fieldErrorsFrom } from '@/lib/validation/site';

export interface SupplierFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: string;
}

export async function addSupplier(
  _prev: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const principal = await requirePermission('supplier:create');

  const parsed = supplierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let id: string;
  try {
    id = await createSupplier(principal, parsed.data, parseSupplies(formData));
  } catch (error) {
    if (error instanceof SupplierError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'supplier.create',
    entityType: 'Supplier',
    entityId: id,
    after: { name: parsed.data.name },
  });

  revalidatePath('/suppliers');
  redirect(`/suppliers/${id}`);
}

export async function editSupplier(
  supplierId: string,
  _prev: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const principal = await requirePermission('supplier:edit');

  const parsed = supplierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  try {
    await updateSupplier(principal, supplierId, parsed.data, parseSupplies(formData));
  } catch (error) {
    if (error instanceof SupplierError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'supplier.update',
    entityType: 'Supplier',
    entityId: supplierId,
    after: { name: parsed.data.name },
  });

  revalidatePath('/suppliers');
  revalidatePath(`/suppliers/${supplierId}`);
  return { ok: 'Saved.' };
}

/**
 * Archive or restore.
 *
 * The intent is an explicit field rather than inferred from current state — a
 * double tap on a slow connection would otherwise archive and immediately
 * restore, and the person would see nothing happen.
 */
export async function toggleSupplier(
  supplierId: string,
  _prev: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const principal = await requirePermission('supplier:edit');

  const intent = String(formData.get('intent') ?? '');
  if (intent !== 'archive' && intent !== 'restore') {
    return { error: 'That action is not recognised.' };
  }

  let name: string;
  try {
    name = await setSupplierActive(principal, supplierId, intent === 'restore');
  } catch (error) {
    if (error instanceof SupplierError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: intent === 'archive' ? 'supplier.archive' : 'supplier.update',
    entityType: 'Supplier',
    entityId: supplierId,
    after: { isActive: intent === 'restore' },
  });

  revalidatePath('/suppliers');
  revalidatePath(`/suppliers/${supplierId}`);
  return { ok: intent === 'archive' ? `${name} archived.` : `${name} restored.` };
}
