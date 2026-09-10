'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import {
  createProduct,
  updateProduct,
  setProductActive,
  setPrice,
  ProductError,
} from '@/lib/product-service';
import { productSchema, priceSchema } from '@/lib/validation/product';
import { fieldErrorsFrom } from '@/lib/validation/site';

export interface ProductFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: string;
}

export async function saveProduct(
  productId: string | null,
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const principal = await requirePermission(productId ? 'product:edit' : 'product:create');

  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let result;
  try {
    result = productId
      ? await updateProduct(principal, productId, parsed.data)
      : await createProduct(principal, parsed.data);
  } catch (error) {
    if (error instanceof ProductError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: productId ? 'product.update' : 'product.create',
    entityType: 'Product',
    entityId: result.id,
    after: { sku: parsed.data.sku, name: parsed.data.name },
  });

  revalidatePath('/pricing');
  redirect(`/pricing/${result.id}`);
}

/**
 * Setting a price needs `price:edit`, not `product:edit`.
 *
 * They are different rights and the matrix already separates them: a manager may
 * change what a product is called without being the person who decides what it
 * costs. Guarding both behind one permission would quietly widen who can move
 * the farm's prices.
 */
export async function savePrice(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const principal = await requirePermission('price:edit');

  const parsed = priceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  // A BLANK LIST PRICE IS REFUSED. On a buyer row it means "back to the list",
  // which is a real thing to record; on the list itself it would mean nobody can
  // be quoted for this product at all, and taking a product off the list is what
  // the active flag is for.
  if (!parsed.data.customerId && parsed.data.price === null) {
    return {
      fieldErrors: {
        price: 'A list price is needed. To stop selling this, take the product off the list instead.',
      },
    };
  }

  try {
    await setPrice(principal, {
      productId: parsed.data.productId,
      customerId: parsed.data.customerId,
      pricePesewas: parsed.data.price,
      effectiveFrom: parsed.data.effectiveFrom,
      note: parsed.data.note,
    });
  } catch (error) {
    if (error instanceof ProductError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'price.set',
    entityType: 'Product',
    entityId: parsed.data.productId,
    after: {
      customerId: parsed.data.customerId,
      pricePesewas: parsed.data.price,
      effectiveFrom: parsed.data.effectiveFrom.toISOString().slice(0, 10),
      note: parsed.data.note,
    },
  });

  revalidatePath('/pricing');
  revalidatePath(`/pricing/${parsed.data.productId}`);
  return {};
}

export async function toggleActive(
  productId: string,
  isActive: boolean,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: ProductFormState,
): Promise<ProductFormState> {
  const principal = await requirePermission('product:edit');

  try {
    const result = await setProductActive(principal, productId, isActive);
    await recordAudit({
      principal,
      action: 'product.setActive',
      entityType: 'Product',
      entityId: productId,
      after: { name: result.name, isActive },
    });
  } catch (error) {
    if (error instanceof ProductError) return { error: error.message };
    throw error;
  }

  revalidatePath('/pricing');
  revalidatePath(`/pricing/${productId}`);
  return {};
}
