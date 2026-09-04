import type { DISPOSITIONS } from '@/lib/validation/production';

type ProductionDisposition = (typeof DISPOSITIONS)[number];

/**
 * Produce entering the store — ADRAH Farms
 *
 * The join between two ledgers that until now have not spoken. A collection is
 * recorded against a flock; a stock movement is recorded against an item in a
 * store. This module decides, from data already read, exactly what the second
 * should be given the first — and does it as pure arithmetic so the decision can
 * be tested without a database and read without one either.
 *
 * WHY A PLAN RATHER THAN A WRITE
 *   Recording what came out of the house must never fail because of something
 *   about the store. A grade nobody has linked to an item, a farm with no store
 *   flagged, a collection that was destroyed rather than sold — all of these are
 *   ordinary, and none of them is a reason to refuse a person who is standing in
 *   a poultry house with a tray in one hand. So this returns a PLAN or a REASON,
 *   and the caller writes the plan if there is one and shows the reason if there
 *   is not. Nothing here throws.
 *
 * WHAT DOES NOT HAPPEN HERE, DELIBERATELY
 *   No cost is put on an egg. See `PRODUCE_ENTERS_UNCOSTED` below.
 */

export interface StockableGrade {
  gradeId: string;
  gradeName: string;
  /** The stock item this grade is held as. Null is the ordinary case. */
  itemId: string | null;
  itemName: string | null;
  /** The item's base unit — `piece` for eggs. */
  itemBaseUnit: string | null;
  /** Whether the item is still in use. An archived item receives nothing. */
  itemIsActive: boolean;
  /** How long the produce keeps. Null when nobody has stated a figure. */
  shelfLifeDays: number | null;
}

export interface ProductionStore {
  id: string;
  name: string;
}

export interface CollectedLine {
  gradeId: string;
  /** Signed, in the grade's base unit. Negative on a correction. */
  quantityBase: number;
}

export interface StockLine {
  gradeId: string;
  gradeName: string;
  itemId: string;
  itemName: string;
  /** Positive, in the item's base unit. */
  quantityBase: number;
  unitKey: string;
}

export type StockPlan =
  | {
      status: 'planned';
      storeId: string;
      storeName: string;
      /** One batch per flock per day, shared by every collection of that day. */
      batchNumber: string;
      expiresOn: Date | null;
      lines: StockLine[];
    }
  | { status: 'none'; reason: string };

/**
 * PRODUCE ENTERS THE STORE UNCOSTED, AND THAT IS A DECISION.
 *
 * A batch received from a supplier carries the price on the invoice. A batch of
 * eggs carries no such number, and there is no honest way to invent one on the
 * morning they are laid:
 *
 *   - The month's wages and the electricity have not been allocated yet, so the
 *     flock's own cost per bird is incomplete on any given day.
 *   - Cost per egg falls as a flock comes into full lay and rises again at the
 *     end, so a figure written on Tuesday is wrong by Friday.
 *   - Whatever is written onto the batch is what stock valuation and, later,
 *     cost of goods sold will use. A number invented here would quietly become
 *     the farm's official one.
 *
 * The flock cost ledger already answers "what has this flock cost". Dividing it
 * by eggs produced is a REPORT, computed when it is asked for from figures that
 * are complete by then — not a value stamped onto a batch on the day.
 */
export const PRODUCE_ENTERS_UNCOSTED = true;

/**
 * Only produce fit for sale becomes stock.
 *
 * Held, destroyed and home-use collections are all recorded, all counted, and
 * all appear in the production figures — they simply never become something the
 * store says it has. Putting held eggs into the same item as sellable ones would
 * make the two indistinguishable, and the first consequence of that is somebody
 * selling eggs that were held back for a reason.
 */
export function dispositionStocks(disposition: ProductionDisposition): boolean {
  return disposition === 'SALEABLE';
}

const DISPOSITION_REASON: Record<ProductionDisposition, string> = {
  SALEABLE: '',
  HELD: 'held back, so it is recorded but not counted as stock that can be sold',
  DISCARDED: 'destroyed, so nothing went into the store',
  HOME_USE: 'used on the farm, so nothing went into the store',
};

/**
 * The batch number for one flock's produce on one day.
 *
 * ONE BATCH A DAY, not one per collection. The morning and evening walks of the
 * same house on the same day produce eggs of the same age from the same birds;
 * splitting them into two batches would double the rows in the store for no
 * information gained, and would make first-expiry-first-out pick between two
 * batches that expire at the same moment.
 *
 * The flock code is in it because that is what makes a batch traceable back to
 * the birds — the question asked after a recall, or after a customer complaint.
 */
export function batchNumberFor(flockCode: string, onDate: Date): string {
  return `${flockCode}-${onDate.toISOString().slice(0, 10)}`;
}

/**
 * When this batch stops being fit to sell.
 *
 * FORMULA: collection date + shelf life in days.
 *
 * Null when no shelf life has been set, and no default is shipped. How long an
 * egg keeps depends on whether it was washed, how it is stored and how hot the
 * room is — none of which this software knows. A batch with no expiry date
 * reports none, which is honest; a batch with a guessed one would be trusted.
 */
export function expiryFor(onDate: Date, shelfLifeDays: number | null): Date | null {
  if (shelfLifeDays === null || !Number.isFinite(shelfLifeDays) || shelfLifeDays <= 0) {
    return null;
  }
  const expires = new Date(onDate.getTime());
  expires.setUTCDate(expires.getUTCDate() + Math.round(shelfLifeDays));
  return expires;
}

export interface PlanInput {
  flockCode: string;
  onDate: Date;
  disposition: ProductionDisposition;
  lines: CollectedLine[];
  grades: StockableGrade[];
  /** The store this site sends its produce to. Null when none is flagged. */
  store: ProductionStore | null;
}

/**
 * What this collection should put into the store, or why it should put nothing.
 *
 * Every "nothing" carries a sentence a person can act on. "No stock movement was
 * created" tells somebody that something did not happen; "No store at this farm
 * is set to receive produce" tells them what to do about it.
 */
export function planProductionStock(input: PlanInput): StockPlan {
  if (!dispositionStocks(input.disposition)) {
    return {
      status: 'none',
      reason: `This collection was ${DISPOSITION_REASON[input.disposition]}.`,
    };
  }

  if (!input.store) {
    return {
      status: 'none',
      reason:
        'No store at this farm is set to receive produce, so the collection was recorded ' +
        'without touching stock. Mark one in Store → Stores and later collections will go there.',
    };
  }

  const byId = new Map(input.grades.map((g) => [g.gradeId, g]));

  const lines: StockLine[] = [];
  const archived: string[] = [];

  for (const line of input.lines) {
    const grade = byId.get(line.gradeId);
    if (!grade || grade.itemId === null || grade.itemBaseUnit === null) continue;
    if (!grade.itemIsActive) {
      archived.push(grade.gradeName);
      continue;
    }
    // A zero line is not written. A movement of nothing is a row that says an
    // event happened when none did.
    if (!Number.isFinite(line.quantityBase) || line.quantityBase <= 0) continue;

    lines.push({
      gradeId: grade.gradeId,
      gradeName: grade.gradeName,
      itemId: grade.itemId,
      itemName: grade.itemName ?? grade.gradeName,
      quantityBase: line.quantityBase,
      unitKey: grade.itemBaseUnit,
    });
  }

  if (lines.length === 0) {
    if (archived.length > 0) {
      return {
        status: 'none',
        reason:
          `The store item for ${archived.join(' and ')} has been archived, so nothing was ` +
          `added to stock. The collection itself is recorded in full.`,
      };
    }
    return {
      status: 'none',
      reason:
        'None of these grades is held as stock, so the collection was recorded without ' +
        'touching the store. Link a grade to a store item in Settings → Grades to change that.',
    };
  }

  // The shelf life of the first stockable grade sets the batch date. In practice
  // every grade of one produce keeps for the same time; taking the first rather
  // than the shortest keeps one batch number meaning one thing, and the figure
  // is advisory in any case — it dates a batch, it never refuses one.
  const shelfLife = byId.get(lines[0].gradeId)?.shelfLifeDays ?? null;

  return {
    status: 'planned',
    storeId: input.store.id,
    storeName: input.store.name,
    batchNumber: batchNumberFor(input.flockCode, input.onDate),
    expiresOn: expiryFor(input.onDate, shelfLife),
    lines,
  };
}

/**
 * What the screen says after saving, in one sentence.
 *
 * Said every time, whether produce reached the store or not. A person who has
 * just recorded 340 eggs and is told nothing about the store cannot tell the
 * difference between "it went in" and "it silently did not".
 */
export function stockNote(plan: StockPlan, produceWord = 'produce'): string {
  if (plan.status === 'none') return plan.reason;

  const total = plan.lines.reduce((sum, l) => sum + l.quantityBase, 0);
  const named =
    plan.lines.length === 1
      ? plan.lines[0].itemName
      : `${plan.lines.length} ${produceWord.toLowerCase()} items`;

  return (
    `${total.toLocaleString('en-GH')} added to ${plan.storeName} as ${named}` +
    (plan.expiresOn ? `, best before ${plan.expiresOn.toISOString().slice(0, 10)}.` : '.')
  );
}

/**
 * The reversal of a plan, for a corrected collection.
 *
 * Takes what actually WENT IN rather than recomputing from the grades, for the
 * same reason a reversed cost allocation mirrors its entries: a grade unlinked
 * from its item since, or a shelf life changed since, would make a fresh
 * calculation disagree with what is actually sitting in the store. A reversal
 * that does not exactly cancel is worse than none.
 */
export interface PostedMovement {
  itemId: string;
  itemBatchId: string | null;
  stockLocationId: string;
  /** Signed as it was posted: positive when produce went in. */
  deltaBase: number;
  unitKey: string;
}

export function reverseOf(posted: PostedMovement[]): PostedMovement[] {
  return posted
    .filter((m) => m.deltaBase !== 0)
    .map((m) => ({ ...m, deltaBase: -m.deltaBase }));
}
