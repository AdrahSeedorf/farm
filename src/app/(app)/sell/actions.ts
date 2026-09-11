'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { sellAtCounter, sellableProducts, CounterSaleError } from '@/lib/counter-sale-service';
import {
  counterSaleSchema,
  quantitySchema,
  priceSchema,
} from '@/lib/validation/counter-sale';
import { fieldErrorsFrom } from '@/lib/validation/site';
import type { Warning } from '@/lib/warnings';
import type { CounterLineInput } from '@/lib/counter-sale';

export interface SellFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Set when a withdrawal period refused the sale. */
  clearsOn?: string;
  warnings?: Warning[];
  warningToken?: string;
}

/**
 * One submit: a buyer, an order, its lines, its confirmation and a load.
 *
 * BOTH PERMISSIONS ARE REQUIRED. This writes an order and moves stock, so it
 * needs the rights for both — checked separately rather than inventing a third
 * permission that would then have to be kept in step with the other two.
 */
export async function sell(
  _prev: SellFormState,
  formData: FormData,
): Promise<SellFormState> {
  const principal = await requirePermission('order:create');
  await requirePermission('delivery:create');

  const parsed = counterSaleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  // Products are read from the database, not from the form, so a tampered form
  // cannot introduce a product that is not on this farm's list.
  const products = await sellableProducts(
    principal,
    parsed.data.siteId,
    parsed.data.buyerMode === 'EXISTING' ? parsed.data.customerId : null,
  );

  const lines: CounterLineInput[] = [];
  const fieldErrors: Record<string, string> = {};
  for (const product of products) {
    const rawQuantity = formData.get(`qty-${product.id}`);
    const quantity = quantitySchema.safeParse(
      typeof rawQuantity === 'string' ? rawQuantity : '',
    );
    if (!quantity.success) {
      fieldErrors[`qty-${product.id}`] = 'How many? A number, or leave it blank.';
      continue;
    }
    if (quantity.data === 0) continue;

    const rawPrice = formData.get(`price-${product.id}`);
    const price = priceSchema.safeParse(typeof rawPrice === 'string' ? rawPrice : '');
    if (!price.success) {
      fieldErrors[`price-${product.id}`] = 'That is not an amount. Write it like 45 or 45.50.';
      continue;
    }

    lines.push({
      productId: product.id,
      quantity: quantity.data,
      pricePesewas: price.data,
    });
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  let result;
  try {
    result = await sellAtCounter(
      principal,
      {
        siteId: parsed.data.siteId,
        buyer: {
          mode: parsed.data.buyerMode,
          customerId: parsed.data.customerId,
          name: parsed.data.buyerName,
          phone: parsed.data.buyerPhone,
        },
        lines,
        drawnFromFlockId: parsed.data.flockId,
        takenBy: parsed.data.takenBy,
        notes: parsed.data.notes,
      },
      parsed.data.acknowledged,
    );
  } catch (error) {
    if (error instanceof CounterSaleError) return { error: error.message };
    throw error;
  }

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
    action: 'counterSale.sell',
    entityType: 'SalesOrder',
    entityId: result.orderId,
    after: {
      orderNumber: result.orderNumber,
      reference: result.reference,
      customerId: result.customerId,
      lines: lines.length,
    },
  });

  revalidatePath('/sell');
  revalidatePath('/orders');
  revalidatePath('/dispatch');
  revalidatePath('/customers');
  revalidatePath('/inventory');
  // Lands on the LOAD, not the order: the thing that just happened is that
  // produce left the farm, and the load is the page that says so.
  redirect(`/dispatch/${result.dispatchId}`);
}
