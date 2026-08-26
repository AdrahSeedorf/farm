import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, siteIdFilter, hasFullSiteAccess } from '@/lib/scope';
import { weightedUnitCost, type BatchStock } from '@/lib/stock-ledger';
import { recordStockMovement, StockMovementError } from '@/lib/stock-movements';
import { checkReceipt, suggestBatchNumber } from '@/lib/receiving';
import { warningToken, type Warning } from '@/lib/warnings';
import { recordAudit } from '@/lib/audit';
import type { ReceiptInput } from '@/lib/validation/receipt';

/**
 * Receiving service — ADRAH Farms
 *
 * Turns "four bags of layer mash arrived" into a ledger entry, a batch and a
 * cost. Owns the warn-then-confirm loop; owns nothing about signs or units,
 * which belong to `stock-movements.ts`.
 */

export type ReceiptResult =
  | {
      status: 'saved';
      movementId: string;
      itemName: string;
      batchNumber: string | null;
      onHandBase: number;
      unitKey: string;
      itemId: string;
    }
  | { status: 'needsConfirmation'; warnings: Warning[]; token: string }
  | { status: 'error'; message: string };

/** Everything the receive form needs, in three queries rather than one per item. */
export async function receiptContext(principal: Principal) {
  const [items, locations, units] = await Promise.all([
    db.item.findMany({
      where: { ...orgFilter(principal), isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: { stockUom: true },
    }),
    db.stockLocation.findMany({
      where: { site: { ...orgFilter(principal), ...siteIdFilter(principal) }, isActive: true },
      orderBy: [{ site: { name: 'asc' } }, { name: 'asc' }],
      include: { site: { select: { name: true } } },
    }),
    db.unitOfMeasure.findMany({ orderBy: [{ dimension: 'asc' }, { factorToBase: 'asc' }] }),
  ]);

  return {
    items: items.map((i) => ({
      id: i.id,
      sku: i.sku,
      name: i.name,
      category: i.category,
      unitKey: i.stockUom.key,
      unitName: i.stockUom.name,
      dimension: i.stockUom.dimension,
      isPerishable: i.isPerishable,
    })),
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      code: l.code,
      siteName: l.site.name,
    })),
    units: units.map((u) => ({
      key: u.key,
      name: u.name,
      symbol: u.symbol,
      dimension: u.dimension,
    })),
    /** Owners see every store; a supervisor sees only theirs. */
    scopedToAllSites: hasFullSiteAccess(principal),
  };
}

/**
 * The weighted cost of what is already on hand, in pesewas per base unit.
 *
 * Used only to warn about a price that has moved sharply. Returns null when
 * nothing on hand carries a cost, so a first delivery never triggers a
 * comparison against a price that does not exist.
 */
export async function currentUnitCost(itemId: string): Promise<number | null> {
  const [batches, sums] = await Promise.all([
    db.itemBatch.findMany({ where: { itemId } }),
    db.stockMovement.groupBy({
      by: ['itemBatchId'],
      where: { itemId, itemBatchId: { not: null } },
      _sum: { deltaBase: true },
    }),
  ]);

  const onHand = new Map(sums.map((s) => [s.itemBatchId, s._sum.deltaBase ?? 0]));
  const stock: BatchStock[] = batches.map((b) => ({
    id: b.id,
    batchNumber: b.batchNumber,
    expiresOn: b.expiresOn,
    onHand: onHand.get(b.id) ?? 0,
    unitCostPesewas: b.unitCostPesewas,
  }));

  return weightedUnitCost(stock);
}

export async function submitReceipt(
  principal: Principal,
  input: ReceiptInput,
): Promise<ReceiptResult> {
  const item = await db.item.findFirst({
    where: { id: input.itemId, ...orgFilter(principal) },
    include: { stockUom: true },
  });
  if (!item) return { status: 'error', message: 'That item no longer exists.' };

  const previousUnitCostPesewas = await currentUnitCost(item.id);

  const warnings = checkReceipt({
    quantityEntered: input.quantity,
    priceCedis: input.priceCedis,
    unitKey: input.enteredUomKey,
    expiresOn: input.expiresOn,
    occurredOn: input.occurredOn,
    isPerishable: item.isPerishable,
    previousUnitCostPesewas,
  });

  if (warnings.length > 0) {
    const token = warningToken(warnings);
    // Only an acknowledgement of THESE warnings counts.
    if (input.acknowledgedToken !== token) {
      return { status: 'needsConfirmation', warnings, token };
    }
  }

  // A delivery with no supplier reference still gets a batch, so "the bad
  // batch" is a conversation the records can actually support later.
  const batchNumber =
    input.batchNumber ??
    suggestBatchNumber(
      item.sku,
      input.occurredOn,
      await db.itemBatch.count({
        where: { itemId: item.id, receivedOn: input.occurredOn },
      }),
    );

  try {
    const movement = await recordStockMovement(principal, {
      itemId: item.id,
      stockLocationId: input.stockLocationId,
      type: 'PURCHASE_RECEIPT',
      quantityEntered: input.quantity,
      enteredUomKey: input.enteredUomKey,
      occurredOn: input.occurredOn,
      batchNumber,
      expiresOn: input.expiresOn,
      priceCedis: input.priceCedis,
      notes: joinNotes(input.reference, input.notes),
      sourceType: input.reference ? 'delivery' : null,
    });

    await recordAudit({
      principal,
      action: 'stock.receipt',
      entityType: 'StockMovement',
      entityId: movement.id,
      after: {
        item: item.sku,
        quantity: input.quantity,
        unit: input.enteredUomKey,
        batch: movement.batchNumber,
        unitCostPesewas: movement.unitCostPesewas,
        acknowledgedWarnings: warnings.map((w) => w.message),
      },
    });

    return {
      status: 'saved',
      movementId: movement.id,
      itemId: item.id,
      itemName: item.name,
      batchNumber: movement.batchNumber,
      onHandBase: movement.onHandBase,
      unitKey: item.stockUom.key,
    };
  } catch (error) {
    if (error instanceof StockMovementError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

/** Supplier reference first, because that is what gets searched for. */
function joinNotes(reference: string | null, notes: string | null): string | null {
  const parts = [reference, notes].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(' — ') : null;
}
