import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, siteIdFilter, hasFullSiteAccess } from '@/lib/scope';
import { stockStatus, type StockStatus } from '@/lib/stock-ledger';
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
