import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, canAccessSite, siteFilter } from '@/lib/scope';
import { warningToken, type Warning } from '@/lib/warnings';
import { recordMovementWithin, batchStockAt } from '@/lib/stock-movements';
import { selectBatchesFEFO } from '@/lib/stock-ledger';
import { BASE_UNIT, fromBase, toBase, type Dimension } from '@/lib/uom';
import { round } from '@/lib/metrics';
import {
  adjustmentNote,
  countErrors,
  countWarnings,
  discrepancies,
  referenceFor,
  sequenceOf,
  varianceOf,
  type CountLine,
} from '@/lib/stock-take';

/**
 * Stock take service — ADRAH Farms
 *
 * THE ONLY PLACE A StockTake IS WRITTEN, and the only writer of ADJUSTMENT
 * movements that come from a count.
 *
 * TWO FACTS, ONE TRANSACTION.
 *   The count and the adjustments it justifies either both land or neither does.
 *   A count saved without its adjustment is a store you know is wrong and have
 *   not fixed; an adjustment saved without its count is a correction nobody can
 *   account for. Both of those are worse than the write failing.
 *
 * THE EXPECTED FIGURE IS READ ON THE SERVER, NOT TAKEN FROM THE FORM.
 *   The sheet the storekeeper counts onto shows what the ledger said when it was
 *   opened, and the form sends that figure back. It is NOT what gets stored, and
 *   it never decides the size of an adjustment — a hidden input is a number the
 *   browser controls, and a trusted one here would let anybody write an
 *   adjustment of any size into the stock ledger. The server reads the ledger
 *   itself and compares against that.
 *
 *   The figure from the form is still used, for exactly one thing: if it
 *   disagrees with what the server reads, the store moved between opening the
 *   sheet and saving it, and the person is told so. It is a warning, not a
 *   refusal — their count is still what they saw.
 *
 *   Stored, the server's figure is then frozen forever. "Snapshotted, not
 *   recomputed" is about what happens AFTERWARDS: a receipt entered next week but
 *   dated last week changes what the same sum returns, and the variance this
 *   count found must not silently change with it.
 *
 * WHICH BATCH A CORRECTION COMES OUT OF — the part that is easy to get wrong.
 *   A shortage is taken FEFO across the batches at that store, one movement per
 *   batch, exactly like an issue. If the location total and the batch totals were
 *   allowed to drift apart, the headline figure would show stock that FEFO can
 *   never select and dispatch can never send — stock that exists on a report and
 *   nowhere else.
 *
 *   A surplus goes into a batch of its own, named after the stock take. Nobody
 *   knows when found stock was produced, so it carries no expiry and no cost,
 *   which sorts it LAST in FEFO. That is the wrong way round for freshness and it
 *   is deliberate: it should be slightly awkward, because the right fix for
 *   found stock is almost always to go and enter the receipt that was missed.
 */

export class StockTakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockTakeError';
  }
}

// ---------------------------------------------------------------------------
// THE SHEET
// ---------------------------------------------------------------------------

export interface SheetLine {
  itemId: string;
  itemName: string;
  sku: string;
  category: string;
  /** The item's own counting unit — "bags", "crates" — for the label. */
  displayUnitKey: string;
  displayUnitName: string;
  /** The base unit quantities are stored and submitted in. */
  baseUnitKey: string;
  expectedBase: number;
  /** The same figure in the unit the storekeeper thinks in. */
  expectedDisplay: number;
  lastCountedOn: Date | null;
}

export interface CountSheet {
  stockLocationId: string;
  locationName: string;
  siteId: string;
  lastCountedOn: Date | null;
  lines: SheetLine[];
}

/**
 * What to put in front of somebody walking into a store.
 *
 * EVERY ACTIVE ITEM, not only the ones with stock. An item the records show as
 * empty is exactly the one worth looking at, and a sheet that omitted it would
 * make "the records had none and there are twelve" unrecordable — which is the
 * single most useful thing a count can find.
 */
export async function countSheet(
  principal: Principal,
  stockLocationId: string,
): Promise<CountSheet | null> {
  const location = await db.stockLocation.findFirst({
    where: { id: stockLocationId, site: orgFilter(principal) },
    select: { id: true, name: true, siteId: true },
  });
  if (!location) return null;
  if (!canAccessSite(principal, location.siteId)) return null;

  const [items, sums, lastTake, lastLines] = await Promise.all([
    db.item.findMany({
      where: { ...orgFilter(principal), isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: { stockUom: true },
    }),
    db.stockMovement.groupBy({
      by: ['itemId'],
      where: { stockLocationId: location.id },
      _sum: { deltaBase: true },
    }),
    db.stockTake.findFirst({
      where: { stockLocationId: location.id },
      orderBy: [{ countedOn: 'desc' }, { createdAt: 'desc' }],
      select: { countedOn: true },
    }),
    db.stockTakeLine.findMany({
      where: { stockTake: { stockLocationId: location.id } },
      orderBy: { stockTake: { countedOn: 'desc' } },
      select: { itemId: true, stockTake: { select: { countedOn: true } } },
    }),
  ]);

  const onHand = new Map(sums.map((s) => [s.itemId, s._sum.deltaBase ?? 0]));
  const lastPerItem = new Map<string, Date>();
  for (const line of lastLines) {
    if (!lastPerItem.has(line.itemId)) lastPerItem.set(line.itemId, line.stockTake.countedOn);
  }

  return {
    stockLocationId: location.id,
    locationName: location.name,
    siteId: location.siteId,
    lastCountedOn: lastTake?.countedOn ?? null,
    lines: items.map((item) => {
      const dimension = item.stockUom.dimension as Dimension;
      const baseUnitKey = BASE_UNIT[dimension];
      const expectedBase = round(onHand.get(item.id) ?? 0, 3) ?? 0;
      return {
        itemId: item.id,
        itemName: item.name,
        sku: item.sku,
        category: item.category,
        displayUnitKey: item.stockUom.key,
        displayUnitName: item.stockUom.name,
        baseUnitKey,
        expectedBase,
        expectedDisplay: round(fromBase(expectedBase, item.stockUom.key), 3) ?? 0,
        lastCountedOn: lastPerItem.get(item.id) ?? null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// RECORDING
// ---------------------------------------------------------------------------

/**
 * One line off the sheet, EXACTLY AS TYPED.
 *
 * The number is in the item's own counting unit — bags, crates, trays — because
 * that is what the person is holding. CONVERSION HAPPENS HERE, NOT IN THE
 * ACTION: the unit belongs to the item, the server looks it up, and a form that
 * claimed a different one would be a form choosing its own arithmetic.
 */
export interface SubmittedLine {
  itemId: string;
  /** What was on the shelf, in the ITEM'S counting unit. Null means not counted. */
  countedEntered: number | null;
  /** What the sheet showed when it was opened, same unit. Used ONLY to detect drift. */
  shownExpectedEntered: number;
  cause?: string | null;
  note?: string | null;
}

export interface RecordCountInput {
  stockLocationId: string;
  countedOn: Date;
  notes?: string | null;
  lines: SubmittedLine[];
}

export type RecordCountResult =
  | { status: 'refused'; message: string }
  | { status: 'needsConfirmation'; warnings: Warning[]; token: string }
  | {
      status: 'recorded';
      id: string;
      reference: string;
      corrected: number;
      counted: number;
    };

export async function recordStockTake(
  principal: Principal,
  input: RecordCountInput,
  acknowledgedToken: string | null = null,
  today: Date = new Date(),
): Promise<RecordCountResult> {
  const location = await db.stockLocation.findFirst({
    where: { id: input.stockLocationId, site: orgFilter(principal) },
    select: { id: true, name: true, siteId: true, isActive: true },
  });
  if (!location) return { status: 'refused', message: 'That store no longer exists.' };
  if (!canAccessSite(principal, location.siteId)) {
    return { status: 'refused', message: 'That store is at a farm you do not cover.' };
  }

  const submitted = input.lines.filter((l) => l.countedEntered !== null);
  if (submitted.length === 0) {
    return { status: 'refused', message: 'Nothing has been counted yet.' };
  }

  const items = await db.item.findMany({
    where: { id: { in: submitted.map((l) => l.itemId) }, ...orgFilter(principal) },
    include: { stockUom: true },
  });
  const itemById = new Map(items.map((i) => [i.id, i]));
  const missing = submitted.find((l) => !itemById.has(l.itemId));
  if (missing) {
    return { status: 'refused', message: 'Something on that sheet is no longer on the item list.' };
  }

  // THE SERVER'S OWN FIGURE. Read here, not taken from the form.
  const expectedByItem = await expectedAt(db, location.id, submitted.map((l) => l.itemId));

  const lines: CountLine[] = submitted.map((l) => {
    const item = itemById.get(l.itemId)!;
    return {
      itemId: l.itemId,
      itemName: item.name,
      unitKey: BASE_UNIT[item.stockUom.dimension as Dimension],
      expectedBase: expectedByItem.get(l.itemId) ?? 0,
      countedBase: round(toBase(l.countedEntered!, item.stockUom.key), 3),
      cause: l.cause ?? null,
      note: l.note ?? null,
      // So every message speaks in bags and crates rather than kilograms.
      display: {
        unitName: item.stockUom.name,
        factorToBase: toBase(1, item.stockUom.key),
      },
    };
  });

  const problems = countErrors({ lines, countedOn: input.countedOn, today });
  if (problems.length > 0) return { status: 'refused', message: problems[0] };

  const unitByItem = new Map(items.map((i) => [i.id, i.stockUom.key]));
  const warnings = [...driftWarnings(lines, submitted, unitByItem), ...countWarnings(lines)];
  if (warnings.length > 0) {
    const token = warningToken(warnings);
    if (acknowledgedToken !== token) return { status: 'needsConfirmation', warnings, token };
  }

  try {
    const created = await db.$transaction(async (tx) => {
      // Read again inside the transaction. If the store moved between the
      // warning pass and here, the adjustment would be computed from a figure
      // that is already wrong — and the person was never shown the drift.
      const fresh = await expectedAt(tx, location.id, lines.map((l) => l.itemId));
      for (const line of lines) {
        if ((fresh.get(line.itemId) ?? 0) !== line.expectedBase) {
          throw new StockTakeError(
            `Somebody recorded a movement against ${line.itemName} while this was being saved. ` +
              `Nothing has been saved. Open the sheet again so your count is compared against the current figure.`,
          );
        }
      }

      const reference = await nextReference(tx, principal.organisationId, input.countedOn);

      const take = await tx.stockTake.create({
        data: {
          organisationId: principal.organisationId,
          stockLocationId: location.id,
          reference,
          countedOn: input.countedOn,
          countedById: principal.userId,
          notes: input.notes?.trim() || null,
        },
        select: { id: true, reference: true },
      });

      for (const line of lines) {
        const variance = varianceOf(line)!;
        const movementId =
          variance === 0
            ? null
            : await writeAdjustment(tx, principal, {
                line,
                variance,
                stockLocationId: location.id,
                occurredOn: input.countedOn,
                reference: take.reference,
                stockTakeId: take.id,
              });

        await tx.stockTakeLine.create({
          data: {
            stockTakeId: take.id,
            itemId: line.itemId,
            countedBase: line.countedBase!,
            expectedBase: line.expectedBase,
            varianceBase: variance,
            cause: variance === 0 ? null : (line.cause ?? null),
            note: line.note?.trim() || null,
            movementId,
          },
        });
      }

      return take;
    });

    return {
      status: 'recorded',
      id: created.id,
      reference: created.reference,
      counted: lines.length,
      corrected: discrepancies(lines).length,
    };
  } catch (error) {
    if (error instanceof StockTakeError) return { status: 'refused', message: error.message };
    throw error;
  }
}

/**
 * Where the ledger moved while somebody was counting.
 *
 * A WARNING, NEVER A REFUSAL. A delivery that arrived mid-count is real stock
 * that was not there when the shelf was counted, and forcing the on-hand figure
 * to equal the count would erase it. The variance is measured against the figure
 * as it is NOW, which is the only figure the adjustment can honestly correct —
 * and the person is told the ground moved so they can decide whether to count
 * that item again.
 */
function driftWarnings(
  lines: CountLine[],
  submitted: SubmittedLine[],
  unitByItem: Map<string, string>,
): Warning[] {
  const shown = new Map(submitted.map((l) => [l.itemId, l.shownExpectedEntered]));
  const warnings: Warning[] = [];
  for (const line of lines) {
    const unitKey = unitByItem.get(line.itemId)!;
    const was = shown.get(line.itemId);
    if (was === undefined) continue;
    const nowEntered = round(fromBase(line.expectedBase, unitKey), 3) ?? 0;
    if (round(was, 3) === nowEntered) continue;
    warnings.push({
      field: `count-${line.itemId}`,
      message:
        `The records for ${line.itemName} changed while you were counting — the sheet showed ${was}, ` +
        `and they now say ${nowEntered}. Somebody recorded a movement. Your count is being ` +
        `compared against the newer figure.`,
    });
  }
  return warnings;
}

/** Current on-hand per item at one location, from the ledger. */
async function expectedAt(
  client: Pick<Prisma.TransactionClient, 'stockMovement'>,
  stockLocationId: string,
  itemIds: string[],
): Promise<Map<string, number>> {
  const sums = await client.stockMovement.groupBy({
    by: ['itemId'],
    where: { stockLocationId, itemId: { in: itemIds } },
    _sum: { deltaBase: true },
  });
  const map = new Map<string, number>(itemIds.map((id) => [id, 0]));
  for (const row of sums) map.set(row.itemId, round(row._sum.deltaBase ?? 0, 3) ?? 0);
  return map;
}

/**
 * Write the correction into the stock ledger.
 *
 * Returns the FIRST movement's id, for the screen. The authority is the
 * `sourceType`/`sourceId` pair on the movements themselves — a shortage spread
 * over three batches is three rows, and one column cannot hold three.
 */
async function writeAdjustment(
  tx: Prisma.TransactionClient,
  principal: Principal,
  args: {
    line: CountLine;
    variance: number;
    stockLocationId: string;
    occurredOn: Date;
    reference: string;
    stockTakeId: string;
  },
): Promise<string | null> {
  const { line, variance, stockLocationId, occurredOn, reference, stockTakeId } = args;
  const notes = adjustmentNote(reference, line);
  const common = {
    itemId: line.itemId,
    stockLocationId,
    type: 'ADJUSTMENT' as const,
    enteredUomKey: line.unitKey,
    occurredOn,
    reasonCode: 'stock_take',
    notes,
    sourceType: 'StockTake',
    sourceId: stockTakeId,
  };

  // A SURPLUS: into a batch of its own, so it can actually be sold.
  if (variance > 0) {
    const movement = await recordMovementWithin(tx, principal, {
      ...common,
      quantityEntered: variance,
      batchNumber: `FOUND-${reference}`,
      // No expiry. Nobody knows when found stock was produced, and inventing a
      // date would put a freshness claim on the shelf that nothing supports.
      expiresOn: null,
    });
    return movement.id;
  }

  // A SHORTAGE: out of the batches that are there, oldest-dated first.
  const batches = await batchStockAt(tx, line.itemId, stockLocationId);
  const { allocations, shortfall } = selectBatchesFEFO(batches, Math.abs(variance));

  const ids: string[] = [];
  for (const allocation of allocations) {
    const movement = await recordMovementWithin(tx, principal, {
      ...common,
      quantityEntered: -allocation.quantity,
      itemBatchId: allocation.batchId,
    });
    ids.push(movement.id);
  }

  // Whatever the batches could not account for was unbatched stock to begin
  // with — an earlier count's surplus, most often. It comes off the location
  // with no batch, exactly as it went on.
  if (shortfall > 0) {
    const movement = await recordMovementWithin(tx, principal, {
      ...common,
      quantityEntered: -shortfall,
    });
    ids.push(movement.id);
  }

  return ids[0] ?? null;
}

/**
 * The next ST number for the year, inside the caller's transaction.
 *
 * Read-then-write behind a unique index, like every other reference in this
 * system. Not a sequence: a sequence skips numbers on a rolled-back transaction,
 * and a gap in a numbered series of count sheets is the kind of thing an auditor
 * asks about for an hour.
 */
async function nextReference(
  tx: Prisma.TransactionClient,
  organisationId: string,
  on: Date,
): Promise<string> {
  const year = on.getUTCFullYear();
  const latest = await tx.stockTake.findFirst({
    where: { organisationId, reference: { startsWith: `ST-${year}-` } },
    orderBy: { reference: 'desc' },
    select: { reference: true },
  });
  return referenceFor(year, sequenceOf(latest?.reference ?? '', year) + 1);
}

// ---------------------------------------------------------------------------
// READING IT BACK
// ---------------------------------------------------------------------------

export interface StockTakeSummary {
  id: string;
  reference: string;
  locationName: string;
  countedOn: Date;
  countedByName: string;
  notes: string | null;
  countedCount: number;
  varianceCount: number;
}

export async function listStockTakes(
  principal: Principal,
  options: { stockLocationId?: string; take?: number } = {},
): Promise<StockTakeSummary[]> {
  const rows = await db.stockTake.findMany({
    where: {
      ...orgFilter(principal),
      // Site scoping INSIDE the where clause, never after the fetch.
      stockLocation: siteFilter(principal),
      ...(options.stockLocationId ? { stockLocationId: options.stockLocationId } : {}),
    },
    orderBy: [{ countedOn: 'desc' }, { createdAt: 'desc' }],
    take: options.take ?? 50,
    include: {
      stockLocation: { select: { name: true } },
      countedBy: { select: { name: true } },
      lines: { select: { varianceBase: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    locationName: row.stockLocation.name,
    countedOn: row.countedOn,
    countedByName: row.countedBy.name,
    notes: row.notes,
    countedCount: row.lines.length,
    varianceCount: row.lines.filter((l) => l.varianceBase !== 0).length,
  }));
}

export interface StockTakeDetail extends StockTakeSummary {
  lines: {
    itemId: string;
    itemName: string;
    displayUnitName: string;
    countedBase: number;
    expectedBase: number;
    varianceBase: number;
    countedDisplay: number;
    expectedDisplay: number;
    varianceDisplay: number;
    cause: string | null;
    note: string | null;
  }[];
}

export async function stockTakeById(
  principal: Principal,
  id: string,
): Promise<StockTakeDetail | null> {
  const row = await db.stockTake.findFirst({
    where: { id, ...orgFilter(principal), stockLocation: siteFilter(principal) },
    include: {
      stockLocation: { select: { name: true } },
      countedBy: { select: { name: true } },
      lines: {
        orderBy: { item: { name: 'asc' } },
        include: { item: { include: { stockUom: true } } },
      },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    reference: row.reference,
    locationName: row.stockLocation.name,
    countedOn: row.countedOn,
    countedByName: row.countedBy.name,
    notes: row.notes,
    countedCount: row.lines.length,
    varianceCount: row.lines.filter((l) => l.varianceBase !== 0).length,
    lines: row.lines.map((line) => {
      const unitKey = line.item.stockUom.key;
      return {
        itemId: line.itemId,
        itemName: line.item.name,
        displayUnitName: line.item.stockUom.name,
        countedBase: line.countedBase,
        expectedBase: line.expectedBase,
        varianceBase: line.varianceBase,
        countedDisplay: round(fromBase(line.countedBase, unitKey), 3) ?? 0,
        expectedDisplay: round(fromBase(line.expectedBase, unitKey), 3) ?? 0,
        varianceDisplay: round(fromBase(line.varianceBase, unitKey), 3) ?? 0,
        cause: line.cause,
        note: line.note,
      };
    }),
  };
}

/**
 * When each store this person can see was last counted.
 *
 * Used by the period report, which until now could only say that nobody had
 * counted anything — because nothing could.
 */
export async function lastCountedByLocation(
  principal: Principal,
): Promise<{ stockLocationId: string; locationName: string; lastCountedOn: Date | null }[]> {
  const locations = await db.stockLocation.findMany({
    where: { site: { ...orgFilter(principal) }, ...siteFilter(principal), isActive: true },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      stockTakes: {
        orderBy: [{ countedOn: 'desc' }, { createdAt: 'desc' }],
        take: 1,
        select: { countedOn: true },
      },
    },
  });

  return locations.map((l) => ({
    stockLocationId: l.id,
    locationName: l.name,
    lastCountedOn: l.stockTakes[0]?.countedOn ?? null,
  }));
}

