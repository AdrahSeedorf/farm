/**
 * Stock ledger rules — ADRAH Farms
 *
 * ARCHITECTURAL RULE #1, applied to inventory.
 *
 * There is no `quantityOnHand` column on `Item`. Stock is the signed sum of an
 * append-only ledger, exactly as bird population is. The reasoning is the same:
 * a farm where someone can type a corrected stock figure into a field ends up
 * with a number that disagrees with its own receipts and issues, and nobody can
 * say which is true.
 *
 * This module holds the pure rules, with no database imports, so the sign of a
 * movement can never be decided ad hoc at a call site.
 */

export type StockMovementType =
  | 'PURCHASE_RECEIPT'
  | 'ISSUE'
  | 'RETURN'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'ADJUSTMENT'
  | 'DAMAGE'
  | 'EXPIRY'
  | 'SALE'
  | 'PRODUCTION'
  | 'CONSUMPTION';

/**
 * Which way each movement pushes the stock figure.
 *
 * ADJUSTMENT is 0 because it is the one movement that may go either way; its
 * caller supplies an already-signed quantity.
 *
 * ON ISSUE VERSUS CONSUMPTION — the double-counting trap.
 *   ISSUE is feed leaving the store for a house. CONSUMPTION is feed eaten by
 *   birds. They are NOT two views of the same event, and recording both against
 *   the same stock would remove the feed twice.
 *
 *   The store's ledger tracks the store. Once feed is issued to a house it has
 *   left the store, and what the birds do with it is a production question, not
 *   a stock one. CONSUMPTION exists here for species and setups that hold stock
 *   at the house — it is deliberately unused in the layer flow.
 */
const MOVEMENT_DIRECTION: Record<StockMovementType, -1 | 0 | 1> = {
  PURCHASE_RECEIPT: 1,
  RETURN: 1,
  TRANSFER_IN: 1,
  PRODUCTION: 1,
  ISSUE: -1,
  TRANSFER_OUT: -1,
  DAMAGE: -1,
  EXPIRY: -1,
  SALE: -1,
  CONSUMPTION: -1,
  ADJUSTMENT: 0,
};

/** Movements that mean stock was lost rather than used or sold. */
export const WASTE_MOVEMENTS: readonly StockMovementType[] = ['DAMAGE', 'EXPIRY'];

export class StockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockError';
  }
}

/**
 * The signed change for a movement. THE ONLY place a stock sign is decided.
 *
 * @param quantity a POSITIVE quantity in the item's base unit, except for
 *                 ADJUSTMENT where a signed value is required
 */
export function stockDeltaFor(type: StockMovementType, quantity: number): number {
  if (!Number.isFinite(quantity)) {
    throw new StockError(`Quantity must be a number, received ${quantity}`);
  }

  if (type === 'ADJUSTMENT') {
    if (quantity === 0) {
      throw new StockError('An adjustment of zero records nothing — omit it instead');
    }
    return quantity; // already signed, deliberately
  }

  if (quantity <= 0) {
    throw new StockError(
      `${type} requires a positive quantity, received ${quantity}. ` +
        `Do not encode direction in the number — the movement type carries it.`,
    );
  }

  return MOVEMENT_DIRECTION[type] * quantity;
}

export interface StockMovementRecord {
  type: StockMovementType;
  deltaBase: number;
  occurredOn: Date;
  itemBatchId?: string | null;
}

/** Quantity on hand, in the item's base unit, derived from the ledger. */
export function quantityOnHand(movements: StockMovementRecord[], asOf?: Date): number {
  const cutoff = asOf ? endOfDay(asOf) : null;
  return movements.reduce((total, m) => {
    if (cutoff && m.occurredOn.getTime() > cutoff) return total;
    return total + m.deltaBase;
  }, 0);
}

/** Quantity on hand per batch, for expiry-aware issuing. */
export function quantityByBatch(movements: StockMovementRecord[]): Map<string, number> {
  const byBatch = new Map<string, number>();
  for (const m of movements) {
    if (!m.itemBatchId) continue;
    byBatch.set(m.itemBatchId, (byBatch.get(m.itemBatchId) ?? 0) + m.deltaBase);
  }
  return byBatch;
}

// ---------------------------------------------------------------------------
// BATCHES AND EXPIRY
// ---------------------------------------------------------------------------

export interface BatchStock {
  id: string;
  batchNumber: string;
  expiresOn: Date | null;
  onHand: number;
  unitCostPesewas?: number | null;
}

export interface Allocation {
  batchId: string;
  batchNumber: string;
  quantity: number;
  expiresOn: Date | null;
}

export interface AllocationResult {
  allocations: Allocation[];
  /** How much could not be covered by the batches on hand. */
  shortfall: number;
}

/**
 * Choose which batches to draw from: FIRST EXPIRY, FIRST OUT.
 *
 * Not first-in-first-out. A vaccine received later may expire sooner, and
 * issuing the longer-dated one first guarantees the shorter-dated one is thrown
 * away. FEFO is what actually reduces waste, and for medicines it is the
 * difference between using a product and destroying it.
 *
 * Batches with no expiry — feed, packaging — sort last, since they can wait.
 *
 * Returns a shortfall rather than throwing: being short is a fact about the
 * store, and the caller decides whether that blocks the operation.
 */
export function selectBatchesFEFO(batches: BatchStock[], quantity: number): AllocationResult {
  if (quantity <= 0) return { allocations: [], shortfall: 0 };

  const available = batches
    .filter((b) => b.onHand > 0)
    .sort((a, b) => {
      if (a.expiresOn && b.expiresOn) return a.expiresOn.getTime() - b.expiresOn.getTime();
      if (a.expiresOn) return -1;
      if (b.expiresOn) return 1;
      return a.batchNumber.localeCompare(b.batchNumber);
    });

  const allocations: Allocation[] = [];
  let remaining = quantity;

  for (const batch of available) {
    if (remaining <= 0) break;
    const take = Math.min(batch.onHand, remaining);
    allocations.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      quantity: take,
      expiresOn: batch.expiresOn,
    });
    remaining -= take;
  }

  return { allocations, shortfall: Math.max(0, roundQuantity(remaining)) };
}

/** Batches already past their date but still showing stock. */
export function expiredBatches(batches: BatchStock[], on: Date): BatchStock[] {
  return batches.filter(
    (b) => b.onHand > 0 && b.expiresOn !== null && b.expiresOn.getTime() < startOfDay(on),
  );
}

/** Batches due to expire within `days`, so they can be used first or written off. */
export function expiringSoon(batches: BatchStock[], on: Date, days = 30): BatchStock[] {
  const from = startOfDay(on);
  const to = from + days * 86_400_000;
  return batches
    .filter(
      (b) =>
        b.onHand > 0 &&
        b.expiresOn !== null &&
        b.expiresOn.getTime() >= from &&
        b.expiresOn.getTime() <= to,
    )
    .sort((a, b) => (a.expiresOn!.getTime() - b.expiresOn!.getTime()));
}

/**
 * The weighted cost of what is actually on hand, in pesewas per base unit.
 *
 * Batches carry their own cost because feed bought in March and feed bought in
 * July are not the same money. Averaging across what remains is what makes a
 * feed issue chargeable to a flock at something close to the truth.
 *
 * Returns null when no batch on hand carries a cost — better than a zero that
 * would quietly make feed look free.
 */
export function weightedUnitCost(batches: BatchStock[]): number | null {
  const priced = batches.filter(
    (b) => b.onHand > 0 && typeof b.unitCostPesewas === 'number' && b.unitCostPesewas >= 0,
  );
  if (priced.length === 0) return null;

  const totalQuantity = priced.reduce((sum, b) => sum + b.onHand, 0);
  if (totalQuantity <= 0) return null;

  const totalValue = priced.reduce((sum, b) => sum + b.onHand * (b.unitCostPesewas ?? 0), 0);
  return Math.round(totalValue / totalQuantity);
}

/**
 * How many days the stock will last at the recent rate of use.
 *
 * Returns null when nothing is being used — dividing by zero would give
 * Infinity, and "∞ days of feed" on a dashboard is worse than an honest dash.
 */
export function daysOfCover(onHand: number, averageDailyUse: number): number | null {
  if (!Number.isFinite(onHand) || !Number.isFinite(averageDailyUse)) return null;
  if (averageDailyUse <= 0) return null;
  return onHand / averageDailyUse;
}

// ---------------------------------------------------------------------------
// THRESHOLDS
// ---------------------------------------------------------------------------

export type StockStatus = 'OUT' | 'CRITICAL' | 'LOW' | 'OK' | 'UNTRACKED';

/**
 * Where a quantity sits against its thresholds. All figures in the base unit.
 *
 * `UNTRACKED` is returned when no threshold is set, and is deliberately not the
 * same as `OK`: "this is fine" and "nobody said what fine means" are different
 * statements, and a dashboard that renders them identically will show a store
 * full of green while half of it has never been given a reorder level.
 *
 * The order of the checks matters. Minimum stock is the harder floor, so it is
 * tested before the reorder level even when a farm has set them the wrong way
 * round.
 */
export function stockStatus(
  onHand: number,
  reorderLevel: number | null,
  minimumStock: number | null,
): StockStatus {
  if (onHand <= 0) return 'OUT';
  if (minimumStock !== null && onHand <= minimumStock) return 'CRITICAL';
  if (reorderLevel !== null && onHand <= reorderLevel) return 'LOW';
  if (reorderLevel === null && minimumStock === null) return 'UNTRACKED';
  return 'OK';
}

/**
 * Sanity check for the rebuild job: stock should never be negative.
 *
 * A negative figure means an issue was recorded against the wrong item, or a
 * receipt was never entered. It must surface rather than quietly clamp.
 */
export function assertStockCoherent(movements: StockMovementRecord[], itemName = 'item'): void {
  const sorted = [...movements].sort((a, b) => a.occurredOn.getTime() - b.occurredOn.getTime());
  let running = 0;
  for (const m of sorted) {
    running += m.deltaBase;
    if (roundQuantity(running) < 0) {
      throw new StockError(
        `Stock for ${itemName} fell below zero on ` +
          `${m.occurredOn.toISOString().slice(0, 10)} after a ${m.type}. ` +
          `A receipt is missing, or a movement belongs to a different item.`,
      );
    }
  }
}

/** Quantities are floats (kilograms, litres); tidy the arithmetic dust. */
function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function endOfDay(d: Date): number {
  return startOfDay(d) + 86_399_999;
}
