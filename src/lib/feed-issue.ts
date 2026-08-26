import type { Allocation } from '@/lib/stock-ledger';
import type { Warning } from '@/lib/warnings';

/**
 * Feed issue rules — ADRAH Farms
 *
 * What it costs to put feed in front of a flock, and what to say when the store
 * disagrees with the house. Pure arithmetic, no database.
 *
 * WHY "ISSUED" AND "FED" ARE THE SAME EVENT HERE, DELIBERATELY
 *
 *   A stricter design would track feed twice: once leaving the store for the
 *   house, and again as the birds ate it, with the house holding its own stock
 *   in between. That is genuinely more accurate — it is also a second daily
 *   workflow, performed by someone carrying bags, to reconcile a difference of a
 *   day or two.
 *
 *   For a farm drawing one house from one store, the accuracy bought does not
 *   pay for the discipline required, and a workflow that is skipped produces
 *   worse data than one that never existed. So the daily feed figure IS the
 *   issue: the store's balance means "feed bought and not yet fed".
 *
 *   The point at which this stops being the right trade is worth naming: several
 *   houses drawing from one store, where per-house feed variance is the number
 *   the manager actually wants. At that point the house becomes its own stock
 *   location and CONSUMPTION starts being recorded separately — which is why
 *   that movement type already exists in the ledger.
 */

export interface AllocationCost {
  /** Total cost of the feed issued, in integer pesewas. */
  pesewas: number;
  /** How much was drawn from batches that carry no price at all. */
  uncostedBase: number;
}

/**
 * What the issued feed cost, batch by batch.
 *
 * FORMULA, per batch: round( quantity × unitCostPesewas )
 *
 * Costed batch by batch rather than at an item-wide average, because that is
 * the whole reason FEFO picks a specific batch: the 50 kg drawn today came out
 * of a particular delivery at a particular price, and averaging that away would
 * make the flock's feed cost a smooth line that never matches an invoice.
 *
 * Feed drawn from a batch with no recorded price contributes NOTHING rather than
 * a guess — and is reported separately, so "this flock's feed cost is
 * understated" can be said out loud instead of being silently true.
 */
export function costOfAllocations(
  allocations: Allocation[],
  costByBatchId: Map<string, number | null>,
): AllocationCost {
  let pesewas = 0;
  let uncostedBase = 0;

  for (const a of allocations) {
    const unitCost = costByBatchId.get(a.batchId);
    if (unitCost === null || unitCost === undefined) {
      uncostedBase += a.quantity;
      continue;
    }
    pesewas += Math.round(a.quantity * unitCost);
  }

  return { pesewas, uncostedBase };
}

/**
 * What to say when the store cannot cover what was fed.
 *
 * WARN, NEVER BLOCK — and here that rule matters more than anywhere else in the
 * system. The daily record carries the morning's mortality. Refusing to save it
 * because the feed arithmetic does not balance would mean a farm losing birds to
 * a brooder failure could not record that they had died. The store being wrong
 * is a bookkeeping problem; the birds are not.
 *
 * So the record always saves. The issue takes whatever the store actually holds,
 * and the gap is stated plainly: it means a delivery was never entered.
 */
export function checkFeedIssue(input: {
  requestedBase: number;
  availableBase: number;
  itemName: string;
  storeName: string;
}): Warning[] {
  const warnings: Warning[] = [];
  const short = round(input.requestedBase - input.availableBase);

  if (short > 0) {
    warnings.push({
      field: 'feedKg',
      message:
        `The store shows only ${round(input.availableBase)} kg of ${input.itemName} in ` +
        `${input.storeName}, but ${round(input.requestedBase)} kg was fed. ` +
        `The record will be saved in full and the store taken to zero — ` +
        `a delivery has probably not been entered.`,
    });
  } else if (input.availableBase > 0 && short > -0.001) {
    warnings.push({
      field: 'feedKg',
      message: `This takes ${input.itemName} in ${input.storeName} down to nothing.`,
    });
  }

  return warnings;
}

/** Said after the fact, on the saved record, rather than as a pre-save warning. */
export function uncostedNote(uncostedBase: number, itemName: string): string | null {
  if (uncostedBase <= 0) return null;
  return (
    `${round(uncostedBase)} kg of ${itemName} came from a batch with no recorded price, ` +
    `so this flock's feed cost is understated by that much.`
  );
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
