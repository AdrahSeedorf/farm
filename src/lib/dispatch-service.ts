import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, siteFilter, canAccessSite } from '@/lib/scope';
import { orderById, withdrawalCheck } from '@/lib/sales-service';
import { issueFromStock, recordMovementWithin } from '@/lib/stock-movements';
import { warningToken, type Warning } from '@/lib/warnings';
import {
  referenceFor,
  sequenceOf,
  progressOf,
  dispatchErrors,
  dispatchWarnings,
  reversalErrors,
  whyNotDispatchable,
  type Dispatch,
  type DispatchLine,
  type DispatchLineInput,
  type DispatchMethod,
  type LineProgress,
  type AvailableStock,
} from '@/lib/dispatch';

/**
 * Dispatch service — ADRAH Farms
 *
 * THE ONLY PLACE A Dispatch OR DispatchLine IS WRITTEN, and the only place on
 * the sales side that touches the stock ledger.
 *
 * THE WITHDRAWAL GATE IS CHECKED AGAIN HERE, AND THIS IS THE IMPORTANT ONE.
 *
 *   Confirmation checks it (see sales-service.ts) but confirmation happens on the
 *   phone, possibly days early. A treatment recorded on Thursday morning restricts
 *   an order confirmed on Monday, and the only moment left to stop that produce is
 *   the moment it goes onto the vehicle. So the gate runs here too, and here it
 *   REFUSES — it is not a warning that can be acknowledged away, because the farm
 *   makes this promise publicly and a warning somebody clicks past is not a
 *   promise.
 *
 * STOCK COMES OFF AS A SALE, NOT AN ISSUE. The ledger has to be able to tell
 * "the farm used it" from "the farm sold it" without joining to anything.
 *
 * NOTHING HERE RECORDS MONEY. A dispatch is not an invoice. See sales.ts.
 */

export class DispatchError extends Error {
  constructor(
    message: string,
    /** Set when the refusal is a withdrawal period, so the screen can say when. */
    readonly clearsOn: Date | null = null,
  ) {
    super(message);
    this.name = 'DispatchError';
  }
}

const include = {
  salesOrder: {
    select: {
      id: true,
      orderNumber: true,
      customer: { select: { name: true, businessName: true } },
    },
  },
  recordedBy: { select: { name: true } },
  reversedBy: { select: { name: true } },
  lines: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      product: { select: { name: true, packLabel: true, unitsPerPack: true } },
    },
  },
} as const;

type DbDispatch = Awaited<ReturnType<typeof findDispatches>>[number];

function findDispatches(where: object) {
  return db.dispatch.findMany({
    where,
    orderBy: [{ dispatchedOn: 'desc' }, { createdAt: 'desc' }],
    include,
  });
}

function toLine(row: DbDispatch['lines'][number]): DispatchLine {
  return {
    id: row.id,
    salesOrderLineId: row.salesOrderLineId,
    productId: row.productId,
    productName: row.product.name,
    packLabel: row.product.packLabel,
    unitsPerPack: row.product.unitsPerPack,
    quantity: row.quantity,
  };
}

function toDispatch(row: DbDispatch): Dispatch {
  const customer = row.salesOrder.customer;
  return {
    id: row.id,
    reference: row.reference,
    salesOrderId: row.salesOrderId,
    orderNumber: row.salesOrder.orderNumber,
    customerName: customer.businessName
      ? `${customer.businessName} · ${customer.name}`
      : customer.name,
    method: row.method as DispatchMethod,
    dispatchedOn: row.dispatchedOn,
    takenBy: row.takenBy,
    vehicle: row.vehicle,
    receivedBy: row.receivedBy,
    notes: row.notes,
    lines: row.lines.map(toLine),
    recordedByName: row.recordedBy?.name ?? null,
    createdAt: row.createdAt,
    reversedAt: row.reversedAt,
    reversedByName: row.reversedBy?.name ?? null,
    reversalReason: row.reversalReason,
  };
}

// ---------------------------------------------------------------------------
// READING
// ---------------------------------------------------------------------------

export async function listDispatches(
  principal: Principal,
  options: { salesOrderId?: string; take?: number } = {},
): Promise<Dispatch[]> {
  const rows = await findDispatches({
    ...orgFilter(principal),
    ...siteFilter(principal),
    ...(options.salesOrderId ? { salesOrderId: options.salesOrderId } : {}),
  });
  const limited = options.take ? rows.slice(0, options.take) : rows;
  return limited.map(toDispatch);
}

export async function dispatchById(
  principal: Principal,
  dispatchId: string,
): Promise<Dispatch | null> {
  const row = await db.dispatch.findFirst({
    where: { id: dispatchId, ...orgFilter(principal), ...siteFilter(principal) },
    include,
  });
  return row ? toDispatch(row) : null;
}

/** What is still outstanding on one order, from its dispatch rows. */
export async function orderProgress(
  principal: Principal,
  salesOrderId: string,
): Promise<{ progress: LineProgress[]; dispatches: Dispatch[] } | null> {
  const order = await orderById(principal, salesOrderId);
  if (!order) return null;
  const dispatches = await listDispatches(principal, { salesOrderId });
  return { progress: progressOf(order.lines, dispatches), dispatches };
}

// ---------------------------------------------------------------------------
// WHERE THE PRODUCE IS HELD
// ---------------------------------------------------------------------------

interface StockRoute {
  productId: string;
  productName: string;
  unitsPerPack: number;
  /** The stock item this product is drawn from, when it is drawn from one. */
  itemId: string | null;
  unitKey: string | null;
  /** Why no stock will move. Null when it will. */
  reason: string | null;
  /** Set when the product may not be sold at all. */
  refusal: string | null;
}

/**
 * How each product on this farm reaches the store, if it does.
 *
 * A PRODUCT WITH NO STOCK BEHIND IT IS ORDINARY, NOT BROKEN. A spent hen is
 * sold and delivered and has never been a row in the store. So this returns a
 * reason rather than throwing — exactly the pattern production-stock.ts uses on
 * the way in, and for the same reason: the load has already gone, and refusing
 * to record it does not bring it back.
 */
async function stockRoutes(
  principal: Principal,
  productIds: string[],
): Promise<Map<string, StockRoute>> {
  const products = await db.product.findMany({
    where: { id: { in: productIds }, ...orgFilter(principal) },
    select: {
      id: true,
      name: true,
      unitsPerPack: true,
      grade: {
        select: {
          name: true,
          isSaleable: true,
          itemId: true,
          item: { select: { id: true, isActive: true } },
          baseUom: { select: { key: true } },
        },
      },
    },
  });

  const routes = new Map<string, StockRoute>();
  for (const product of products) {
    const base: StockRoute = {
      productId: product.id,
      productName: product.name,
      unitsPerPack: product.unitsPerPack,
      itemId: null,
      unitKey: null,
      reason: null,
      refusal: null,
    };

    if (!product.grade) {
      routes.set(product.id, {
        ...base,
        reason: 'This is not graded produce, so nothing comes off the store for it.',
      });
      continue;
    }

    if (!product.grade.isSaleable) {
      routes.set(product.id, {
        ...base,
        refusal: `${product.name} is built on ${product.grade.name}, which this farm has marked as not for sale. Change the grade before selling it.`,
      });
      continue;
    }

    if (!product.grade.itemId || !product.grade.item?.isActive) {
      routes.set(product.id, {
        ...base,
        reason: `${product.grade.name} is not held as stock, so the load is recorded but the store does not change.`,
      });
      continue;
    }

    routes.set(product.id, {
      ...base,
      itemId: product.grade.itemId,
      unitKey: product.grade.baseUom.key,
    });
  }

  return routes;
}

/** The store this site's produce goes into — and therefore comes out of. */
async function produceStore(siteId: string) {
  return db.stockLocation.findFirst({
    where: { siteId, receivesProduction: true, isActive: true },
    select: { id: true, name: true },
    orderBy: { code: 'asc' },
  });
}

/**
 * What the store says it holds of each product, in base units.
 *
 * Null means "not held as stock", which is different from zero. A screen that
 * showed 0 for a spent hen would be telling somebody there are none, when in
 * truth nobody is counting.
 */
export async function availableStock(
  principal: Principal,
  siteId: string,
  productIds: string[],
): Promise<AvailableStock[]> {
  const [routes, store] = await Promise.all([
    stockRoutes(principal, productIds),
    produceStore(siteId),
  ]);

  const results: AvailableStock[] = [];
  for (const productId of productIds) {
    const route = routes.get(productId);
    if (!route) continue;
    if (!route.itemId || !store) {
      results.push({ productId, productName: route?.productName ?? '', onHandBase: null });
      continue;
    }
    const sum = await db.stockMovement.aggregate({
      where: { itemId: route.itemId, stockLocationId: store.id },
      _sum: { deltaBase: true },
    });
    results.push({
      productId,
      productName: route.productName,
      onHandBase: Math.round((sum._sum.deltaBase ?? 0) * 100) / 100,
    });
  }
  return results;
}

/** Everything a dispatch screen needs for one order, read once. */
export async function dispatchContext(principal: Principal, salesOrderId: string) {
  const order = await orderById(principal, salesOrderId);
  if (!order) return null;

  const dispatches = await listDispatches(principal, { salesOrderId });
  const progress = progressOf(order.lines, dispatches);
  const productIds = [...new Set(order.lines.map((l) => l.productId))];
  const [stock, store, verdict] = await Promise.all([
    availableStock(principal, order.siteId, productIds),
    produceStore(order.siteId),
    withdrawalCheck(principal, order),
  ]);

  return { order, dispatches, progress, stock, store, verdict };
}

// ---------------------------------------------------------------------------
// RECORDING
// ---------------------------------------------------------------------------

export interface RecordDispatchInput {
  salesOrderId: string;
  method: DispatchMethod;
  dispatchedOn: Date;
  takenBy: string | null;
  vehicle: string | null;
  receivedBy: string | null;
  notes: string | null;
  lines: DispatchLineInput[];
}

export type DispatchResult =
  | {
      status: 'recorded';
      id: string;
      reference: string;
      /** Base units the store could not cover, by product. Empty on an ordinary load. */
      shortfalls: { productName: string; shortfallBase: number }[];
    }
  /**
   * WARN, NEVER BLOCK — but only for warnings the person actually read.
   *
   * The token is a fingerprint of these exact warnings. Change a quantity and it
   * changes with it, so a tick from a moment ago cannot wave through a figure
   * nobody has seen. The same mechanism receiving uses; deliberately shared
   * rather than reimplemented, because a second copy would drift and fail open.
   */
  | { status: 'needsConfirmation'; warnings: Warning[]; token: string }
  /** A hard refusal. `clearsOn` is set when it is a withdrawal period. */
  | { status: 'refused'; message: string; clearsOn: Date | null };

export async function recordDispatch(
  principal: Principal,
  input: RecordDispatchInput,
  acknowledgedToken: string | null = null,
  today: Date = new Date(),
): Promise<DispatchResult> {
  const context = await dispatchContext(principal, input.salesOrderId);
  if (!context) return refuse('That order no longer exists.');
  const { order } = context;

  if (!canAccessSite(principal, order.siteId)) {
    return refuse('That order is at a farm you do not cover.');
  }

  const blocked = whyNotDispatchable(order.state);
  if (blocked) return refuse(blocked);

  /**
   * THE GATE AT THE DOOR.
   *
   * Re-read rather than trusted from confirmation: a treatment recorded this
   * morning restricts a load promised last week, and this is the last moment
   * anything can stop it leaving. A REFUSAL, not a warning — the farm makes this
   * promise publicly, and a warning somebody clicks past is not a promise.
   */
  if (context.verdict.kind !== 'CLEAR') {
    const clearsOn =
      context.verdict.kind === 'NEEDS_SOURCE'
        ? (context.verdict.restricted[0]?.clearsOn ?? null)
        : null;
    return refuse(context.verdict.message, clearsOn);
  }

  const problems = dispatchErrors({
    lines: input.lines,
    method: input.method,
    dispatchedOn: input.dispatchedOn,
    today,
  });
  if (problems.length > 0) return refuse(problems[0]);

  const lines = input.lines.filter((l) => l.quantity > 0);

  const warnings = dispatchWarnings({
    lines,
    progress: context.progress,
    stock: context.stock,
    method: input.method,
    receivedBy: input.receivedBy,
  });
  if (warnings.length > 0) {
    const token = warningToken(warnings);
    if (acknowledgedToken !== token) {
      return { status: 'needsConfirmation', warnings, token };
    }
  }
  const routes = await stockRoutes(
    principal,
    [...new Set(lines.map((l) => l.productId))],
  );

  for (const line of lines) {
    const route = routes.get(line.productId);
    if (!route) return refuse('One of those products is not on the list.');
    if (route.refusal) return refuse(route.refusal);
  }

  const store = context.store;
  const shortfalls: { productName: string; shortfallBase: number }[] = [];

  const created = await db.$transaction(async (tx) => {
    const reference = await nextReference(tx, principal.organisationId, input.dispatchedOn);

    const dispatch = await tx.dispatch.create({
      data: {
        organisationId: principal.organisationId,
        siteId: order.siteId,
        salesOrderId: order.id,
        reference,
        method: input.method,
        dispatchedOn: input.dispatchedOn,
        takenBy: input.takenBy,
        vehicle: input.vehicle,
        receivedBy: input.receivedBy,
        notes: input.notes,
        recordedById: principal.userId,
      },
      select: { id: true, reference: true },
    });

    for (const line of lines) {
      const route = routes.get(line.productId)!;
      let movedBase = 0;
      let shortfallBase = 0;
      let reason: string | null = route.reason;

      if (route.itemId && route.unitKey && store) {
        const wanted = line.quantity * route.unitsPerPack;
        /**
         * FEFO, AND THE SHORTFALL IS KEPT RATHER THAN FORCED.
         *
         * The ledger refuses to go below zero — a rule worth keeping. A load
         * that has already gone out cannot be un-sent, so what the store could
         * cover comes off it and the difference is written down on the line.
         * That number is the measured gap between the shelf and the record, and
         * it usually means a collection went unrecorded.
         */
        const issued = await issueFromStock(tx, principal, {
          itemId: route.itemId,
          stockLocationId: store.id,
          quantityBase: wanted,
          unitKey: route.unitKey,
          occurredOn: input.dispatchedOn,
          type: 'SALE',
          notes: `${dispatch.reference} · ${order.orderNumber}`,
          sourceType: 'Dispatch',
          sourceId: dispatch.id,
        });
        movedBase = issued.issuedBase;
        shortfallBase = issued.shortfallBase;
        if (shortfallBase > 0) {
          shortfalls.push({ productName: route.productName, shortfallBase });
        }
      } else if (!store && route.itemId) {
        reason =
          'This farm has no store flagged to receive produce, so the load is recorded but nothing comes off stock.';
      }

      await tx.dispatchLine.create({
        data: {
          dispatchId: dispatch.id,
          salesOrderLineId: line.salesOrderLineId,
          productId: line.productId,
          quantity: line.quantity,
          stockMovedBase: movedBase,
          stockShortfallBase: shortfallBase,
          stockReason: reason,
        },
      });
    }

    return dispatch;
  });

  return {
    status: 'recorded',
    id: created.id,
    reference: created.reference,
    shortfalls,
  };
}

function refuse(message: string, clearsOn: Date | null = null): DispatchResult {
  return { status: 'refused', message, clearsOn };
}

/**
 * The next DSP number for the year, inside the caller's transaction.
 *
 * Read-then-write, with a unique index behind it. Two people recording loads in
 * the same second is rare on one farm and the constraint catches it; the action
 * retries. Deliberately not a sequence: a sequence that skips numbers on a
 * rolled-back transaction leaves gaps in a series people read as paperwork.
 */
async function nextReference(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  organisationId: string,
  on: Date,
): Promise<string> {
  const year = on.getUTCFullYear();
  const latest = await tx.dispatch.findFirst({
    where: { organisationId, reference: { startsWith: `DSP-${year}-` } },
    orderBy: { reference: 'desc' },
    select: { reference: true },
  });
  return referenceFor(year, sequenceOf(latest?.reference ?? '', year) + 1);
}

// ---------------------------------------------------------------------------
// REVERSING
// ---------------------------------------------------------------------------

/**
 * Put a load back.
 *
 * NOT A DELETE, AND NOT AN EDIT. Every movement the dispatch wrote gets a
 * matching RETURN into the SAME batch, so the store recovers exactly what it
 * lost — including which batch it lost it from, which matters when the batches
 * have different dates on them. Both sets of movements stay visible, and the
 * dispatch keeps its number with the reason written on it.
 *
 * The stock is returned dated TODAY, not on the day the load went out. Putting
 * it back on the original day would rewrite what the store held on a day people
 * have already read; returning it today says what actually happened — it went
 * out then, and came back now.
 */
export async function reverseDispatch(
  principal: Principal,
  dispatchId: string,
  reason: string,
  today: Date = new Date(),
): Promise<{ reference: string; returnedBase: number }> {
  const existing = await db.dispatch.findFirst({
    where: { id: dispatchId, ...orgFilter(principal), ...siteFilter(principal) },
    select: { id: true, reference: true, siteId: true, reversedAt: true },
  });
  if (!existing) throw new DispatchError('That load no longer exists.');
  if (!canAccessSite(principal, existing.siteId)) {
    throw new DispatchError('That load is at a farm you do not cover.');
  }

  const problems = reversalErrors({
    alreadyReversed: existing.reversedAt !== null,
    reason,
  });
  if (problems.length > 0) throw new DispatchError(problems[0]);

  const movements = await db.stockMovement.findMany({
    where: { sourceType: 'Dispatch', sourceId: dispatchId, type: 'SALE' },
    select: {
      itemId: true,
      itemBatchId: true,
      stockLocationId: true,
      deltaBase: true,
      enteredQuantity: true,
      enteredUom: { select: { key: true } },
    },
  });

  let returnedBase = 0;

  await db.$transaction(async (tx) => {
    for (const movement of movements) {
      await recordMovementWithin(tx, principal, {
        itemId: movement.itemId,
        stockLocationId: movement.stockLocationId,
        type: 'RETURN',
        quantityEntered: movement.enteredQuantity,
        enteredUomKey: movement.enteredUom.key,
        occurredOn: today,
        itemBatchId: movement.itemBatchId,
        notes: `Reversal of ${existing.reference}: ${reason.trim()}`,
        sourceType: 'DispatchReversal',
        sourceId: dispatchId,
      });
      returnedBase += Math.abs(movement.deltaBase);
    }

    await tx.dispatch.update({
      where: { id: dispatchId },
      data: {
        reversedAt: today,
        reversedById: principal.userId,
        reversalReason: reason.trim(),
      },
    });
  });

  return { reference: existing.reference, returnedBase: Math.round(returnedBase * 100) / 100 };
}
