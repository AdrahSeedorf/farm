'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { canAccessSite, hasFullSiteAccess, orgFilter, siteIdFilter } from '@/lib/scope';
import { AuthorizationError } from '@/lib/rbac';
import { BASE_UNIT, toBase, formatQuantity, type Dimension } from '@/lib/uom';
import { itemById, movementCountForItem } from '@/lib/stock-service';
import { recordStockMovement, StockMovementError } from '@/lib/stock-movements';
import {
  itemSchema,
  stockLocationSchema,
  deriveSku,
  unitChangeAllowed,
} from '@/lib/validation/item';
import { fieldErrorsFrom } from '@/lib/validation/site';

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: string;
}

/**
 * Inventory actions — ADRAH Farms
 *
 * Same four steps as every other action in the system, in the same order:
 * authorise, validate, mutate scoped to the organisation, audit.
 *
 * ONE INVENTORY-SPECIFIC RULE lives here: thresholds are ENTERED in the unit the
 * farm buys in and STORED in the dimension's base unit. Storing what was typed
 * would mean a reorder level of "4" comparing against an on-hand figure of "200",
 * because one is bags and the other is kilograms — a comparison that is silently
 * wrong rather than loudly broken, which is the worst kind.
 */

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

/** Resolve the posted unit key to a row, or a field error the form can show. */
async function resolveUnit(key: string) {
  const unit = await db.unitOfMeasure.findUnique({ where: { key } });
  if (!unit) return null;
  return unit;
}

export async function createItem(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePermission('inventory:create');

  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const input = parsed.data;

  const unit = await resolveUnit(input.stockUomKey);
  if (!unit) return { fieldErrors: { stockUomKey: 'That unit is no longer available.' } };

  const sku = input.sku ?? deriveSku(input.name, input.category);

  let itemId: string;
  try {
    const item = await db.item.create({
      data: {
        organisationId: principal.organisationId,
        sku,
        name: input.name,
        category: input.category,
        stockUomId: unit.id,
        reorderLevel: toBaseOrNull(input.reorderLevel, unit.key),
        minimumStock: toBaseOrNull(input.minimumStock, unit.key),
        isPerishable: input.isPerishable,
        shelfLifeDays: input.shelfLifeDays,
      },
    });
    itemId = item.id;
    await recordAudit({
      principal,
      action: 'item.create',
      entityType: 'Item',
      entityId: item.id,
      after: { sku, name: input.name, category: input.category, unit: unit.key },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        fieldErrors: {
          sku: input.sku
            ? 'Another item already uses that code.'
            : `The code "${sku}" is already taken. Enter one of your own below.`,
        },
      };
    }
    throw error;
  }

  revalidatePath('/inventory');
  redirect(`/inventory?created=${itemId}`);
}

export async function updateItem(
  itemId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const principal = await requirePermission('inventory:edit');

  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const input = parsed.data;

  const before = await itemById(principal, itemId);
  if (!before) return { error: 'That item no longer exists.' };

  const unit = await resolveUnit(input.stockUomKey);
  if (!unit) return { fieldErrors: { stockUomKey: 'That unit is no longer available.' } };

  // Changing the unit across dimensions would rewrite the meaning of history.
  const movements = await movementCountForItem(itemId);
  const change = unitChangeAllowed(
    before.stockUom.dimension as Dimension,
    unit.dimension as Dimension,
    movements,
  );
  if (!change.allowed) return { fieldErrors: { stockUomKey: change.reason } };

  try {
    const after = await db.item.update({
      where: { id: itemId },
      data: {
        sku: input.sku ?? before.sku,
        name: input.name,
        category: input.category,
        stockUomId: unit.id,
        reorderLevel: toBaseOrNull(input.reorderLevel, unit.key),
        minimumStock: toBaseOrNull(input.minimumStock, unit.key),
        isPerishable: input.isPerishable,
        shelfLifeDays: input.shelfLifeDays,
      },
    });
    await recordAudit({
      principal,
      action: 'item.update',
      entityType: 'Item',
      entityId: itemId,
      before,
      after,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { fieldErrors: { sku: 'Another item already uses that code.' } };
    }
    throw error;
  }

  revalidatePath('/inventory');
  redirect('/inventory');
}

/**
 * Archive an item, or bring it back. Never delete.
 *
 * REFUSES while stock is still on hand. Archiving hides the item from every
 * picker, so archiving with 400 kg in the store does not make the feed go away —
 * it makes it invisible, and the next stock count disagrees with the system for
 * a reason nobody can find. Write it off or issue it first.
 *
 * The caller states the INTENT ("archive" / "restore") rather than asking for a
 * flip. A flip is not idempotent: a double-tap on a slow connection archives and
 * immediately restores, and the storekeeper sees nothing happen at all.
 */
export async function toggleItemActive(
  itemId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const principal = await requirePermission('inventory:edit');

  const intent = formData.get('intent');
  if (intent !== 'archive' && intent !== 'restore') {
    return { error: 'That request was not understood. Try again.' };
  }

  const before = await itemById(principal, itemId);
  if (!before) return { error: 'That item no longer exists.' };

  const shouldBeActive = intent === 'restore';
  if (before.isActive === shouldBeActive) {
    return { ok: `${before.name} is already ${shouldBeActive ? 'in use' : 'archived'}.` };
  }

  if (intent === 'archive') {
    const total = await db.stockMovement.aggregate({
      where: { itemId, item: orgFilter(principal) },
      _sum: { deltaBase: true },
    });
    const onHand = total._sum.deltaBase ?? 0;
    if (onHand > 0) {
      return {
        error:
          `${before.name} still has ${formatQuantity(onHand, BASE_UNIT[before.stockUom.dimension as Dimension], before.stockUom.key)} on hand. ` +
          `Issue it or write it off before archiving, so the store and the system agree.`,
      };
    }
  }

  const after = await db.item.update({
    where: { id: itemId },
    data: { isActive: shouldBeActive },
  });

  await recordAudit({
    principal,
    action: 'item.archive',
    entityType: 'Item',
    entityId: itemId,
    before,
    after,
  });

  revalidatePath('/inventory');
  return { ok: after.isActive ? `${after.name} is back in use.` : `${after.name} archived.` };
}

export async function createStockLocation(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const principal = await requirePermission('inventory:manage');

  const parsed = stockLocationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const input = parsed.data;

  if (!canAccessSite(principal, input.siteId)) {
    throw new AuthorizationError('inventory:manage', input.siteId);
  }
  const site = await db.site.findFirst({ where: { id: input.siteId, ...orgFilter(principal) } });
  if (!site) return { fieldErrors: { siteId: 'That farm no longer exists.' } };

  try {
    const location = await db.stockLocation.create({
      data: { siteId: site.id, name: input.name, code: input.code },
    });
    await recordAudit({
      principal,
      action: 'stockLocation.create',
      entityType: 'StockLocation',
      entityId: location.id,
      after: { name: input.name, code: input.code, siteId: site.id },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { fieldErrors: { code: 'That code is already used at this farm.' } };
    }
    throw error;
  }

  revalidatePath('/inventory/locations');
  return { ok: `${input.name} added.` };
}

/** Entered in the item's unit, stored in the dimension's base unit. */
function toBaseOrNull(quantity: number | null, unitKey: string): number | null {
  return quantity === null ? null : toBase(quantity, unitKey);
}

/**
 * Write off a batch that is past its expiry date.
 *
 * WHY THIS EXISTS AT ALL. An expired batch that still shows stock is a lie the
 * system tells every time anyone opens the page: the figure says the farm holds
 * forty doses of vaccine it cannot legally or safely use. Warning about it
 * without offering a way to correct it just teaches people to ignore the
 * warning.
 *
 * The write-off is an EXPIRY movement, not a deletion. The stock was bought, it
 * was held, and it was lost — all three facts stay on the ledger, which is what
 * makes waste a number the farm can look at later rather than a gap.
 *
 * Requires `inventory:approve`, not `inventory:create`. Destroying value on
 * paper is a heavier act than recording a delivery, and the role matrix already
 * draws that line.
 */
export async function writeOffExpiredBatch(
  itemId: string,
  batchId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const principal = await requirePermission('inventory:approve');

  // The intent is stated rather than implied, for the same reason archiving
  // states it: a stray submit should do nothing, not destroy stock on paper.
  if (formData.get('intent') !== 'writeOff') {
    return { error: 'That request was not understood. Try again.' };
  }

  const item = await itemById(principal, itemId);
  if (!item) return { error: 'That item no longer exists.' };

  const batch = await db.itemBatch.findFirst({
    where: { id: batchId, itemId, item: orgFilter(principal) },
  });
  if (!batch) return { error: 'That batch no longer exists.' };
  if (!batch.expiresOn) {
    return { error: `Batch ${batch.batchNumber} has no expiry date, so there is nothing to write off.` };
  }

  // A batch can sit in more than one store. Write off what each one actually
  // holds rather than assuming it is all in the main store.
  const holdings = await db.stockMovement.groupBy({
    by: ['stockLocationId'],
    where: { itemBatchId: batchId, ...movementScopeFor(principal) },
    _sum: { deltaBase: true },
  });

  const toWriteOff = holdings
    .map((h) => ({ locationId: h.stockLocationId, quantity: h._sum.deltaBase ?? 0 }))
    .filter((h) => h.quantity > 0);

  if (toWriteOff.length === 0) {
    return { ok: `Batch ${batch.batchNumber} already shows nothing on hand.` };
  }

  let total = 0;
  try {
    for (const holding of toWriteOff) {
      await recordStockMovement(principal, {
        itemId,
        stockLocationId: holding.locationId,
        type: 'EXPIRY',
        quantityEntered: holding.quantity,
        enteredUomKey: BASE_UNIT[item.stockUom.dimension as Dimension],
        occurredOn: startOfToday(),
        itemBatchId: batchId,
        reasonCode: 'expired',
        notes: `Expired ${batch.expiresOn.toISOString().slice(0, 10)}`,
      });
      total += holding.quantity;
    }
  } catch (error) {
    if (error instanceof StockMovementError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'stock.writeOff',
    entityType: 'ItemBatch',
    entityId: batchId,
    after: {
      item: item.sku,
      batch: batch.batchNumber,
      expiredOn: batch.expiresOn.toISOString().slice(0, 10),
      quantityBase: total,
    },
  });

  revalidatePath('/inventory');
  revalidatePath(`/inventory/${itemId}`);
  return {
    ok: `Wrote off ${formatQuantity(total, BASE_UNIT[item.stockUom.dimension as Dimension], item.stockUom.key)} from batch ${batch.batchNumber}.`,
  };
}

/** Today at UTC midnight — the only shape of date this system stores. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Movements at stores this principal may see. Mirrors `stock-service`. */
function movementScopeFor(principal: Parameters<typeof orgFilter>[0]) {
  return {
    stockLocation: {
      site: hasFullSiteAccess(principal)
        ? orgFilter(principal)
        : { ...orgFilter(principal), ...siteIdFilter(principal) },
    },
  };
}

/**
 * Choose which store a farm's produce goes into.
 *
 * ONE PER FARM, enforced by clearing the others in the same transaction. Two
 * stores both flagged would make the destination depend on whichever row the
 * query happened to return first — a collection landing in a different building
 * on Tuesday than it did on Monday, for no reason anybody could see.
 *
 * Flagging a store never moves anything. Produce already recorded stays where it
 * was written; only later collections go to the new store, which is the honest
 * behaviour — the eggs are physically where they are.
 */
export async function setProduceStore(
  locationId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const principal = await requirePermission('inventory:manage');

  const intent = String(formData.get('intent') ?? '');
  if (intent !== 'receive' && intent !== 'stop') {
    return { error: 'That action is not recognised.' };
  }

  const location = await db.stockLocation.findFirst({
    where: { id: locationId, site: { ...orgFilter(principal) } },
    select: { id: true, name: true, siteId: true, receivesProduction: true },
  });
  if (!location) return { error: 'That store no longer exists.' };
  if (!canAccessSite(principal, location.siteId)) {
    return { error: 'That store is at a farm you do not cover.' };
  }

  const receives = intent === 'receive';

  await db.$transaction(async (tx) => {
    if (receives) {
      await tx.stockLocation.updateMany({
        where: { siteId: location.siteId, NOT: { id: location.id } },
        data: { receivesProduction: false },
      });
    }
    await tx.stockLocation.update({
      where: { id: location.id },
      data: { receivesProduction: receives },
    });
  });

  await recordAudit({
    principal,
    action: 'stockLocation.produce',
    entityType: 'StockLocation',
    entityId: location.id,
    before: { receivesProduction: location.receivesProduction },
    after: { receivesProduction: receives },
  });

  revalidatePath('/inventory/locations');
  return { ok: receives ? `Produce now goes to ${location.name}.` : undefined };
}
