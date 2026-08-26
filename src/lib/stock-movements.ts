import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { canAccessSite } from '@/lib/scope';
import { stockDeltaFor, type StockMovementType } from '@/lib/stock-ledger';
import { BASE_UNIT, convert, getUnit } from '@/lib/uom';
import { blendBatchCost, decideBatch, unitCostPerBase } from '@/lib/receiving';

/**
 * Stock movement service — ADRAH Farms
 *
 * The ONLY sanctioned way to write to the stock ledger. Nothing else calls
 * `db.stockMovement.create`, for the same reason nothing but `flock-service`
 * writes bird events: the sign, the unit conversion, the batch resolution and
 * the negative-stock refusal all live in one place, so none of them can be
 * forgotten at a call site written in a hurry next year.
 *
 * ARCHITECTURAL RULE #1 in practice: there is no `quantityOnHand` column. Every
 * figure this module reads is a sum over the ledger, taken inside the same
 * transaction as the write.
 */

export class StockMovementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockMovementError';
  }
}

export interface RecordMovementInput {
  itemId: string;
  stockLocationId: string;
  type: StockMovementType;
  /** POSITIVE quantity as the storekeeper typed it, in `enteredUomKey`. */
  quantityEntered: number;
  enteredUomKey: string;
  occurredOn: Date;
  /** Receipts only. Blank means the caller has already chosen a batch number. */
  batchNumber?: string | null;
  expiresOn?: Date | null;
  /** Receipts only: the invoice price per ENTERED unit, in cedis. */
  priceCedis?: number | null;
  /** Issues only: draw from this exact batch, chosen by FEFO upstream. */
  itemBatchId?: string | null;
  reasonCode?: string | null;
  notes?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
}

export interface RecordedMovement {
  id: string;
  deltaBase: number;
  /** Quantity on hand for this item AT THIS LOCATION after the movement. */
  onHandBase: number;
  itemBatchId: string | null;
  batchNumber: string | null;
  unitCostPesewas: number | null;
}

export async function recordStockMovement(
  principal: Principal,
  input: RecordMovementInput,
): Promise<RecordedMovement> {
  return db.$transaction((tx) => recordMovementWithin(tx, principal, input));
}

/**
 * The same write, INSIDE a transaction the caller already owns.
 *
 * Task 6.4 needs this: one daily record issues feed to a house, which is a
 * DailyRecord row, a stock movement and a flock cost entry. Those either all
 * land or none of them do — a feed figure on the daily sheet with no matching
 * movement is the disagreement the ledger exists to prevent.
 */
export async function recordMovementWithin(
  tx: Prisma.TransactionClient,
  principal: Principal,
  input: RecordMovementInput,
): Promise<RecordedMovement> {
  const item = await tx.item.findFirst({
    where: { id: input.itemId, organisationId: principal.organisationId },
    include: { stockUom: true },
  });
  if (!item) throw new StockMovementError('That item no longer exists.');

  const location = await tx.stockLocation.findFirst({
    where: { id: input.stockLocationId, site: { organisationId: principal.organisationId } },
    select: { id: true, name: true, siteId: true, isActive: true },
  });
  if (!location) throw new StockMovementError('That store no longer exists.');
  if (!canAccessSite(principal, location.siteId)) {
    throw new StockMovementError('That store is at a farm you do not cover.');
  }

  // A quantity in the wrong dimension is not a rounding problem, it is a
  // different measurement. `convert` throws across dimensions by design; the
  // check is repeated here so the message names the item rather than the units.
  const entered = getUnit(input.enteredUomKey);
  if (entered.dimension !== item.stockUom.dimension) {
    throw new StockMovementError(
      `${item.name} is measured in ${item.stockUom.dimension.toLowerCase()}, ` +
        `so it cannot be received in ${entered.name.toLowerCase()}.`,
    );
  }

  const quantityBase = convert(
    input.quantityEntered,
    input.enteredUomKey,
    BASE_UNIT[entered.dimension],
  );
  const deltaBase = stockDeltaFor(input.type, quantityBase);

  // --- batch ---------------------------------------------------------------
  let itemBatchId: string | null = input.itemBatchId ?? null;
  let batchNumber: string | null = null;
  let unitCostPesewas: number | null = null;

  const incomingCost =
    input.priceCedis === null || input.priceCedis === undefined
      ? null
      : unitCostPerBase(input.priceCedis, input.enteredUomKey);

  if (input.batchNumber) {
    const existing = await tx.itemBatch.findFirst({
      where: { itemId: item.id, batchNumber: input.batchNumber },
    });

    const decision = decideBatch(
      existing ? { batchNumber: existing.batchNumber, expiresOn: existing.expiresOn } : null,
      input.expiresOn ?? null,
    );
    if (decision.action === 'refuse') throw new StockMovementError(decision.reason);

    if (decision.action === 'create') {
      const created = await tx.itemBatch.create({
        data: {
          itemId: item.id,
          batchNumber: input.batchNumber,
          expiresOn: input.expiresOn ?? null,
          unitCostPesewas: incomingCost,
          receivedOn: input.occurredOn,
        },
      });
      itemBatchId = created.id;
      batchNumber = created.batchNumber;
      unitCostPesewas = created.unitCostPesewas;
    } else {
      // Appending to a batch that already exists: the cost becomes a weighted
      // average of what was actually paid for what is in it.
      const onHand = await tx.stockMovement.aggregate({
        where: { itemBatchId: existing!.id },
        _sum: { deltaBase: true },
      });
      const blended = blendBatchCost(
        { onHandBase: onHand._sum.deltaBase ?? 0, unitCostPesewas: existing!.unitCostPesewas },
        { quantityBase, unitCostPesewas: incomingCost },
      );
      const updated = await tx.itemBatch.update({
        where: { id: existing!.id },
        data: {
          unitCostPesewas: blended,
          ...(decision.action === 'append-and-date' ? { expiresOn: decision.expiresOn } : {}),
        },
      });
      itemBatchId = updated.id;
      batchNumber = updated.batchNumber;
      unitCostPesewas = updated.unitCostPesewas;
    }
  } else if (itemBatchId) {
    const batch = await tx.itemBatch.findFirst({
      where: { id: itemBatchId, itemId: item.id },
      select: { id: true, batchNumber: true, unitCostPesewas: true },
    });
    if (!batch) throw new StockMovementError('That batch does not belong to this item.');
    batchNumber = batch.batchNumber;
    unitCostPesewas = batch.unitCostPesewas;
  }

  // --- refuse driving stock below zero -------------------------------------
  //
  // Re-read INSIDE the transaction, so two people issuing feed at the same
  // moment cannot slip past a check made before either write.
  const running = await tx.stockMovement.aggregate({
    where: { itemId: item.id, stockLocationId: location.id },
    _sum: { deltaBase: true },
  });
  const before = running._sum.deltaBase ?? 0;
  const after = round(before + deltaBase);

  if (after < 0) {
    throw new StockMovementError(
      `Cannot take ${format(Math.abs(deltaBase))} of ${item.name} out of ${location.name} — ` +
        `it holds ${format(before)}. Check whether the receipt was recorded, ` +
        `or whether this belongs to a different store.`,
    );
  }

  const movement = await tx.stockMovement.create({
    data: {
      itemId: item.id,
      itemBatchId,
      stockLocationId: location.id,
      type: input.type,
      deltaBase,
      enteredQuantity: input.quantityEntered,
      enteredUomId: await uomIdFor(tx, input.enteredUomKey),
      occurredOn: input.occurredOn,
      reasonCode: input.reasonCode ?? null,
      notes: input.notes ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      recordedById: principal.userId,
    },
    select: { id: true },
  });

  return {
    id: movement.id,
    deltaBase,
    onHandBase: after,
    itemBatchId,
    batchNumber,
    unitCostPesewas,
  };
}

async function uomIdFor(tx: Prisma.TransactionClient, key: string): Promise<string> {
  const unit = await tx.unitOfMeasure.findUnique({ where: { key }, select: { id: true } });
  if (!unit) throw new StockMovementError(`The unit "${key}" is no longer set up.`);
  return unit.id;
}

/** Quantities are floats (kilograms, litres); tidy the arithmetic dust. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function format(value: number): string {
  return String(round(value));
}
