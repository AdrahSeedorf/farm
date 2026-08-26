import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, siteIdFilter, hasFullSiteAccess } from '@/lib/scope';
import {
  daysOfCover,
  expiredBatches,
  expiringSoon,
  stockStatus,
  type BatchStock,
  type StockStatus,
} from '@/lib/stock-ledger';
import {
  coverSentence,
  coverUrgency,
  runsOutOn,
  usageRate,
  DEFAULT_LEAD_TIME_DAYS,
  DEFAULT_WINDOW_DAYS,
  USAGE_MOVEMENTS,
  type CoverUrgency,
  type UsageRate,
} from '@/lib/stock-cover';
import { fromBase, type Dimension } from '@/lib/uom';

/**
 * Stock read model — ADRAH Farms
 *
 * The read side of the inventory ledger. Writing movements is the job of a
 * separate service (Task 6.3); everything here is derivation.
 *
 * TWO DIFFERENT SCOPES LIVE IN THIS FILE, and confusing them is the bug this
 * comment exists to prevent:
 *
 *   - The item CATALOGUE is organisation-wide. "Layer mash" is one item whether
 *     the business runs one farm or four, otherwise costs can never be compared
 *     across sites.
 *   - Stock QUANTITY is site-scoped, because it is held at a location, and a
 *     location belongs to a site. A supervisor at Farm B sees the same catalogue
 *     as the owner but only Farm B's kilograms.
 *
 * So the item query filters by organisation and the movement query filters by
 * site — both inside the WHERE clause, never after the fetch.
 */

export interface ItemRow {
  id: string;
  sku: string;
  name: string;
  category: string;
  isActive: boolean;
  isPerishable: boolean;
  unitKey: string;
  unitName: string;
  unitSymbol: string;
  dimension: Dimension;
  /** Always in the dimension's base unit — the only figure safe to compare. */
  onHandBase: number;
  /** The same quantity in the unit the farm thinks in. */
  onHandDisplay: number;
  reorderLevelBase: number | null;
  minimumStockBase: number | null;
  status: StockStatus;
  /** How many movements exist, which decides whether the unit may still change. */
  movementCount: number;
}

/**
 * Every item in the catalogue with the quantity this principal can see.
 *
 * TWO queries, not one per item. The obvious implementation — fetch the items,
 * then sum each one's movements — is a query per row, which is invisible on a
 * seeded database and painful at three hundred items over a mobile connection
 * to Frankfurt. `groupBy` does the arithmetic in Postgres.
 */
export async function listItemsWithStock(
  principal: Principal,
  options: { includeInactive?: boolean } = {},
): Promise<ItemRow[]> {
  const [items, sums, counts] = await Promise.all([
    db.item.findMany({
      where: {
        ...orgFilter(principal),
        ...(options.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: { stockUom: true },
    }),
    db.stockMovement.groupBy({
      by: ['itemId'],
      where: movementScope(principal),
      _sum: { deltaBase: true },
    }),
    db.stockMovement.groupBy({
      by: ['itemId'],
      where: movementScope(principal),
      _count: { _all: true },
    }),
  ]);

  const onHandByItem = new Map(sums.map((s) => [s.itemId, s._sum.deltaBase ?? 0]));
  const countByItem = new Map(counts.map((c) => [c.itemId, c._count._all]));

  return items.map((item) => {
    const onHandBase = onHandByItem.get(item.id) ?? 0;
    return {
      id: item.id,
      sku: item.sku,
      name: item.name,
      category: item.category,
      isActive: item.isActive,
      isPerishable: item.isPerishable,
      unitKey: item.stockUom.key,
      unitName: item.stockUom.name,
      unitSymbol: item.stockUom.symbol,
      dimension: item.stockUom.dimension as Dimension,
      onHandBase,
      onHandDisplay: fromBase(onHandBase, item.stockUom.key),
      reorderLevelBase: item.reorderLevel,
      minimumStockBase: item.minimumStock,
      status: stockStatus(onHandBase, item.reorderLevel, item.minimumStock),
      movementCount: countByItem.get(item.id) ?? 0,
    };
  });
}

export interface StockOverviewRow extends ItemRow {
  /** Null when there is too little history to divide by. */
  rate: UsageRate | null;
  /** Null when nothing is being used, or nothing is on hand. */
  daysOfCover: number | null;
  runsOut: Date | null;
  urgency: CoverUrgency;
  sentence: string;
  expired: BatchStock[];
  expiringSoon: BatchStock[];
}

/**
 * The whole store, with cover and expiry worked out.
 *
 * FIVE queries regardless of how many items there are. The shape to avoid is
 * the obvious one — fetch the items, then for each ask "how much is left, how
 * fast is it going, what is expiring" — which is three round trips per row and
 * turns a fifty-item store into a hundred and fifty sequential waits on a
 * database in Europe.
 */
export async function stockOverview(
  principal: Principal,
  asOf: Date = new Date(),
  options: { windowDays?: number; leadTimeDays?: number; expiryHorizonDays?: number } = {},
): Promise<StockOverviewRow[]> {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const leadTimeDays = options.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS;
  const horizon = options.expiryHorizonDays ?? 60;

  const windowStart = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()) -
      (windowDays - 1) * 86_400_000,
  );

  const [items, used, firstSeen, batches, batchSums] = await Promise.all([
    listItemsWithStock(principal),
    db.stockMovement.groupBy({
      by: ['itemId'],
      where: {
        ...movementScope(principal),
        type: { in: [...USAGE_MOVEMENTS] },
        occurredOn: { gte: windowStart },
      },
      _sum: { deltaBase: true },
    }),
    db.stockMovement.groupBy({
      by: ['itemId'],
      where: movementScope(principal),
      _min: { occurredOn: true },
    }),
    db.itemBatch.findMany({ where: { item: orgFilter(principal) } }),
    db.stockMovement.groupBy({
      by: ['itemBatchId'],
      where: { itemBatchId: { not: null }, ...movementScope(principal) },
      _sum: { deltaBase: true },
    }),
  ]);

  // Usage is stored as a NEGATIVE delta; flip the sign once, here, rather than
  // leaving every caller to remember which way round it is.
  const usedByItem = new Map(used.map((u) => [u.itemId, Math.abs(u._sum.deltaBase ?? 0)]));
  const firstByItem = new Map(firstSeen.map((f) => [f.itemId, f._min.occurredOn]));
  const onHandByBatch = new Map(batchSums.map((b) => [b.itemBatchId, b._sum.deltaBase ?? 0]));

  const batchesByItem = new Map<string, BatchStock[]>();
  for (const b of batches) {
    const list = batchesByItem.get(b.itemId) ?? [];
    list.push({
      id: b.id,
      batchNumber: b.batchNumber,
      expiresOn: b.expiresOn,
      onHand: onHandByBatch.get(b.id) ?? 0,
      unitCostPesewas: b.unitCostPesewas,
    });
    batchesByItem.set(b.itemId, list);
  }

  return items.map((item) => {
    const rate = usageRate(
      usedByItem.get(item.id) ?? 0,
      firstByItem.get(item.id) ?? null,
      asOf,
      windowDays,
    );
    const cover = rate === null ? null : daysOfCover(item.onHandBase, rate.perDay);
    const itemBatches = batchesByItem.get(item.id) ?? [];

    return {
      ...item,
      rate,
      daysOfCover: cover,
      runsOut: runsOutOn(asOf, cover),
      urgency: coverUrgency(cover, leadTimeDays),
      sentence: coverSentence(cover, rate, leadTimeDays),
      expired: expiredBatches(itemBatches, asOf),
      expiringSoon: expiringSoon(itemBatches, asOf, horizon),
    };
  });
}

/** One item, or null when it belongs to another organisation. */
export async function itemById(principal: Principal, itemId: string) {
  return db.item.findFirst({
    where: { id: itemId, ...orgFilter(principal) },
    include: { stockUom: true },
  });
}

/** How many movements an item has, across every site — not just the viewer's. */
export async function movementCountForItem(itemId: string): Promise<number> {
  return db.stockMovement.count({ where: { itemId } });
}

/**
 * Batches of one item with what is left in each.
 *
 * Quantities come from the ledger, not from a column on the batch, so a batch
 * that was received and then half issued reports what is actually there.
 */
export async function itemBatches(principal: Principal, itemId: string): Promise<BatchStock[]> {
  const [batches, sums] = await Promise.all([
    db.itemBatch.findMany({
      where: { itemId, item: orgFilter(principal) },
      orderBy: [{ expiresOn: 'asc' }, { receivedOn: 'asc' }],
    }),
    db.stockMovement.groupBy({
      by: ['itemBatchId'],
      where: { itemId, itemBatchId: { not: null }, ...movementScope(principal) },
      _sum: { deltaBase: true },
    }),
  ]);

  const onHand = new Map(sums.map((s) => [s.itemBatchId, s._sum.deltaBase ?? 0]));
  return batches.map((b) => ({
    id: b.id,
    batchNumber: b.batchNumber,
    expiresOn: b.expiresOn,
    onHand: onHand.get(b.id) ?? 0,
    unitCostPesewas: b.unitCostPesewas,
  }));
}

/**
 * Quantity on hand for one item, in the base unit.
 *
 * Aggregated over ALL movements, not summed from the batches. A batch total
 * misses anything recorded without one — a stock-count adjustment, most often —
 * and a headline figure that quietly ignores adjustments is the figure that
 * disagrees with the shelf.
 */
export async function itemOnHand(principal: Principal, itemId: string): Promise<number> {
  const total = await db.stockMovement.aggregate({
    where: { itemId, item: orgFilter(principal), ...movementScope(principal) },
    _sum: { deltaBase: true },
  });
  return total._sum.deltaBase ?? 0;
}

/** The movement history for one item, newest first. */
export async function itemMovements(principal: Principal, itemId: string, take = 25) {
  return db.stockMovement.findMany({
    where: { itemId, item: orgFilter(principal), ...movementScope(principal) },
    orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
    take,
    include: {
      itemBatch: { select: { batchNumber: true } },
      stockLocation: { select: { name: true } },
      enteredUom: { select: { symbol: true, name: true } },
      recordedBy: { select: { name: true } },
    },
  });
}

/** Stores and stores-within-stores this principal may see. */
export async function listStockLocations(principal: Principal) {
  return db.stockLocation.findMany({
    where: { site: { ...orgFilter(principal), ...siteIdFilter(principal) } },
    orderBy: [{ site: { name: 'asc' } }, { name: 'asc' }],
    include: { site: { select: { id: true, name: true, code: true } } },
  });
}

/** The unit catalogue, for pickers. Global rather than per-organisation. */
export async function listUnits() {
  return db.unitOfMeasure.findMany({ orderBy: [{ dimension: 'asc' }, { factorToBase: 'asc' }] });
}

/**
 * Restrict movements to locations at sites this principal may see.
 *
 * An empty `siteScope` means unrestricted, so this returns `{}` for the owner —
 * expressed through `hasFullSiteAccess` rather than a bare `length === 0`, for
 * the reason set out in `scope.ts`.
 */
function movementScope(principal: Principal) {
  const site = hasFullSiteAccess(principal)
    ? orgFilter(principal)
    : { ...orgFilter(principal), ...siteIdFilter(principal) };
  return { stockLocation: { site } };
}
