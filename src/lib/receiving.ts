import { getUnit } from '@/lib/uom';
import { pesewas, type Pesewas } from '@/lib/money';
import type { Warning } from '@/lib/warnings';

/**
 * Goods receipt rules — ADRAH Farms
 *
 * Pure arithmetic and pure decisions, no database. Everything here is a formula
 * a farm manager could check on paper, which is the point: a costing system
 * nobody can reproduce by hand is a costing system nobody trusts.
 */

export class ReceivingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceivingError';
  }
}

// ---------------------------------------------------------------------------
// PRICE
// ---------------------------------------------------------------------------

/**
 * Convert an invoice price into the figure the ledger stores.
 *
 * FORMULA
 *   unitCostPesewas = round( priceCedis × 100 ÷ factorToBase )
 *
 * WHY PER BASE UNIT
 *   An invoice says "GHS 320 per bag". A bag is 50 kg, and stock is stored in
 *   kilograms, so the ledger holds 640 pesewas per kilogram. Storing 320 against
 *   a quantity measured in kilograms would value the same feed at fifty times
 *   its price, and the error would look like a plausible number all the way to
 *   the profit figure.
 *
 * ON THE ROUNDING
 *   Pesewas are integers, so a price that does not divide cleanly loses a
 *   fraction of a pesewa per base unit. GHS 100 for 3 pieces is 3,333.33
 *   pesewas each. `roundingDrift` below reports what that costs across the whole
 *   line so it can be shown rather than absorbed silently.
 */
export function unitCostPerBase(priceCedis: number, unitKey: string): Pesewas {
  if (!Number.isFinite(priceCedis) || priceCedis < 0) {
    throw new ReceivingError(`A price must be a positive amount, received ${priceCedis}`);
  }
  const { factorToBase } = getUnit(unitKey);
  return pesewas(Math.round((priceCedis * 100) / factorToBase));
}

/** What the invoice line should say: quantity as entered × price as entered. */
export function lineTotal(quantityEntered: number, priceCedis: number): Pesewas {
  return pesewas(Math.round(quantityEntered * priceCedis * 100));
}

/**
 * The gap between the invoice line and what the stored per-unit cost implies.
 *
 * Shown to the storekeeper rather than hidden. A drift of one or two pesewas on
 * a GHS 3,200 delivery is arithmetic; a drift of GHS 40 means the quantity or
 * the price was typed wrong, and it is worth catching at the door rather than at
 * the month end.
 */
export function roundingDrift(
  quantityEntered: number,
  priceCedis: number,
  unitKey: string,
): Pesewas {
  const stored = unitCostPerBase(priceCedis, unitKey);
  const { factorToBase } = getUnit(unitKey);
  const impliedFromStored = Math.round(quantityEntered * factorToBase * stored);
  return pesewas(impliedFromStored - lineTotal(quantityEntered, priceCedis));
}

/**
 * The batch's cost after a further receipt into it.
 *
 * A batch is one lot, but a farm can take delivery of the same lot twice, and
 * the second delivery is not always at the first price. The batch then carries a
 * QUANTITY-WEIGHTED average of what was actually paid for what is in it.
 *
 * This does NOT rewrite history. Every issue snapshots the cost that applied on
 * the day it was issued into the flock's cost entries, so changing the batch
 * average affects what is still on the shelf and nothing that has already left
 * it.
 *
 * FORMULA
 *   cost = ( onHandBase × existingCost + receivedBase × receivedCost )
 *          ÷ ( onHandBase + receivedBase )
 */
export function blendBatchCost(
  existing: { onHandBase: number; unitCostPesewas: number | null } | null,
  incoming: { quantityBase: number; unitCostPesewas: number | null },
): number | null {
  if (!existing || existing.unitCostPesewas === null) return incoming.unitCostPesewas;
  if (incoming.unitCostPesewas === null) return existing.unitCostPesewas;

  const priorQuantity = Math.max(0, existing.onHandBase);
  const total = priorQuantity + incoming.quantityBase;
  if (total <= 0) return incoming.unitCostPesewas;

  return Math.round(
    (priorQuantity * existing.unitCostPesewas + incoming.quantityBase * incoming.unitCostPesewas) /
      total,
  );
}

// ---------------------------------------------------------------------------
// BATCHES
// ---------------------------------------------------------------------------

export interface ExistingBatch {
  batchNumber: string;
  expiresOn: Date | null;
}

export type BatchDecision =
  | { action: 'create' }
  | { action: 'append' }
  /** Fills in an expiry the original receipt did not record. */
  | { action: 'append-and-date'; expiresOn: Date }
  | { action: 'refuse'; reason: string };

const sameDay = (a: Date, b: Date) =>
  a.getUTCFullYear() === b.getUTCFullYear() &&
  a.getUTCMonth() === b.getUTCMonth() &&
  a.getUTCDate() === b.getUTCDate();

/**
 * What to do when a receipt names a batch number.
 *
 * REFUSING A CLASHING EXPIRY IS THE POINT OF THIS FUNCTION. Two deliveries under
 * one batch number with different expiry dates are two different lots, and the
 * usual cause is a transposed digit. Merging them would give the older stock the
 * newer date, and FEFO would then hold back the vaccine that is about to expire
 * — the exact waste the whole batch system exists to prevent.
 */
export function decideBatch(
  existing: ExistingBatch | null,
  incomingExpiry: Date | null,
): BatchDecision {
  if (!existing) return { action: 'create' };

  if (existing.expiresOn && incomingExpiry && !sameDay(existing.expiresOn, incomingExpiry)) {
    return {
      action: 'refuse',
      reason:
        `Batch ${existing.batchNumber} is already recorded as expiring ` +
        `${existing.expiresOn.toISOString().slice(0, 10)}, not ` +
        `${incomingExpiry.toISOString().slice(0, 10)}. ` +
        `Two dates under one batch number means two different lots — check the label, ` +
        `or give this delivery its own batch number.`,
    };
  }

  if (!existing.expiresOn && incomingExpiry) {
    return { action: 'append-and-date', expiresOn: incomingExpiry };
  }

  return { action: 'append' };
}

/**
 * A batch number for a delivery that arrived without one.
 *
 * Feed rarely carries a lot number a farm can read; vaccines always do. Rather
 * than leaving batches unnamed — which makes every later conversation about
 * "the bad batch" impossible — a receipt with no supplier reference gets a
 * date-stamped one, with a suffix only when the same item is received twice in
 * a day.
 */
export function suggestBatchNumber(sku: string, on: Date, sameDayCount = 0): string {
  const stamp = on.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = sameDayCount > 0 ? `-${sameDayCount + 1}` : '';
  return `${sku}-${stamp}${suffix}`;
}

// ---------------------------------------------------------------------------
// PLAUSIBILITY — warn, never block
// ---------------------------------------------------------------------------

export type { Warning } from '@/lib/warnings';

/**
 * Checks that make a storekeeper look twice, in the same warn-never-block spirit
 * as the daily record. A delivery that really did arrive at an odd price still
 * has to be recordable — refusing it means it goes unrecorded, and unrecorded
 * stock is worse than surprising stock.
 */
export function checkReceipt(input: {
  quantityEntered: number;
  priceCedis: number | null;
  unitKey: string;
  expiresOn: Date | null;
  occurredOn: Date;
  isPerishable: boolean;
  /** Weighted cost per base unit of what is already on hand, if any. */
  previousUnitCostPesewas: number | null;
}): Warning[] {
  const warnings: Warning[] = [];

  if (input.isPerishable && !input.expiresOn) {
    warnings.push({
      field: 'expiresOn',
      message:
        'This item was set up as expiring, but no expiry date was entered. ' +
        'Without one it cannot be issued shortest-dated first.',
    });
  }

  if (input.expiresOn) {
    const days = Math.round(
      (startOfDay(input.expiresOn) - startOfDay(input.occurredOn)) / 86_400_000,
    );
    if (days < 0) {
      warnings.push({
        field: 'expiresOn',
        message: `This stock expired ${Math.abs(days)} day(s) before it arrived. Check the date on the label.`,
      });
    } else if (days <= 30) {
      warnings.push({
        field: 'expiresOn',
        message: `This stock expires in ${days} day(s). Plan to use it first, or query the delivery.`,
      });
    }
  }

  if (input.priceCedis === null) {
    warnings.push({
      field: 'priceCedis',
      message:
        'No price entered. Stock issued from this delivery will not carry a cost, ' +
        'so it will be missing from the flock costing.',
    });
  } else if (input.previousUnitCostPesewas !== null && input.previousUnitCostPesewas > 0) {
    const incoming = unitCostPerBase(input.priceCedis, input.unitKey);
    const change = (incoming - input.previousUnitCostPesewas) / input.previousUnitCostPesewas;
    if (Math.abs(change) >= 0.25) {
      const direction = change > 0 ? 'higher' : 'lower';
      warnings.push({
        field: 'priceCedis',
        message: `That is ${Math.abs(Math.round(change * 100))}% ${direction} than the stock you already hold. Check the unit on the invoice.`,
      });
    }
  }

  return warnings;
}

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
