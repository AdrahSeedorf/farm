import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, siteIdFilter, canAccessSite } from '@/lib/scope';
import { issueFromStock, StockMovementError } from '@/lib/stock-movements';
import { BASE_UNIT, toBase, type Dimension } from '@/lib/uom';
import { cleaningStatus, cleaningSentence, type CleaningStatus } from '@/lib/biosecurity';
import {
  STAGES_THAT_RESET_THE_CLOCK,
  type CleaningInput,
  type CleaningStage,
} from '@/lib/validation/biosecurity';

/**
 * Cleaning & disinfection — ADRAH Farms
 *
 * THE ONLY PLACE A CleaningRecord IS WRITTEN.
 *
 * A record is written once and never edited. A clean recorded on the wrong day
 * is fixed by recording the right one, exactly as a mortality miscount is fixed
 * by an adjustment rather than a rewrite — and for the same reason: the value of
 * a cleaning log to a vet or a buyer is that nobody can tidy it afterwards.
 */

export class CleaningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CleaningError';
  }
}

export interface CleaningRow {
  id: string;
  siteName: string;
  scope: string;
  productionUnitId: string | null;
  place: string;
  stage: CleaningStage;
  performedOn: Date;
  performedBy: string | null;
  itemName: string | null;
  quantityBase: number | null;
  itemUnit: string | null;
  dilution: string | null;
  contactTimeMinutes: number | null;
  notes: string | null;
  recordedByName: string;
}

const RECORD_SELECT = {
  id: true,
  scope: true,
  productionUnitId: true,
  areaName: true,
  stage: true,
  performedOn: true,
  performedBy: true,
  quantityBase: true,
  dilution: true,
  contactTimeMinutes: true,
  notes: true,
  site: { select: { name: true } },
  productionUnit: { select: { name: true } },
  item: { select: { name: true, stockUom: { select: { dimension: true } } } },
  recordedBy: { select: { name: true } },
} as const;

function toRow(r: {
  id: string;
  scope: string;
  productionUnitId: string | null;
  areaName: string | null;
  stage: string;
  performedOn: Date;
  performedBy: string | null;
  quantityBase: number | null;
  dilution: string | null;
  contactTimeMinutes: number | null;
  notes: string | null;
  site: { name: string };
  productionUnit: { name: string } | null;
  item: { name: string; stockUom: { dimension: string } } | null;
  recordedBy: { name: string };
}): CleaningRow {
  return {
    id: r.id,
    siteName: r.site.name,
    scope: r.scope,
    productionUnitId: r.productionUnitId,
    place: r.productionUnit?.name ?? r.areaName ?? r.site.name,
    stage: r.stage as CleaningStage,
    performedOn: r.performedOn,
    performedBy: r.performedBy,
    itemName: r.item?.name ?? null,
    quantityBase: r.quantityBase,
    // The DIMENSION's base unit, matching what quantityBase is stored in —
    // never the item's display unit. See the factor-of-thirty bug this
    // codebase already shipped once in production stock.
    itemUnit: r.item ? BASE_UNIT[r.item.stockUom.dimension as Dimension] : null,
    dilution: r.dilution,
    contactTimeMinutes: r.contactTimeMinutes,
    notes: r.notes,
    recordedByName: r.recordedBy.name,
  };
}

/** Recent cleaning, newest first. */
export async function recentCleaning(
  principal: Principal,
  limit = 40,
): Promise<CleaningRow[]> {
  const rows = await db.cleaningRecord.findMany({
    where: { site: { ...orgFilter(principal), ...siteIdFilter(principal) } },
    orderBy: [{ performedOn: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    select: RECORD_SELECT,
  });
  return rows.map(toRow);
}

export interface UnitCleaningState {
  productionUnitId: string;
  name: string;
  siteName: string;
  intervalDays: number | null;
  lastCleanedOn: Date | null;
  lastStage: CleaningStage | null;
  status: CleaningStatus;
  days: number | null;
  overdueBy: number | null;
  sentence: string;
}

/**
 * Where each house stands against its own cleaning interval.
 *
 * THE CLOCK IS RESET BY A DISINFECT, A FUMIGATE OR A FULL TURNAROUND — never by
 * a rest period or a dry clean on its own. A house recorded as standing empty
 * is not a house that has been cleaned, and a screen that said "cleaned 2 days
 * ago" on the strength of a REST row would be reporting the opposite of the
 * truth. See STAGES_THAT_RESET_THE_CLOCK.
 */
export async function cleaningByUnit(
  principal: Principal,
  asOf: Date = new Date(),
): Promise<UnitCleaningState[]> {
  const units = await db.productionUnit.findMany({
    where: { site: { ...orgFilter(principal), ...siteIdFilter(principal) }, isActive: true },
    orderBy: [{ site: { name: 'asc' } }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      cleaningIntervalDays: true,
      site: { select: { name: true } },
      cleaningRecords: {
        where: { stage: { in: [...STAGES_THAT_RESET_THE_CLOCK] } },
        orderBy: { performedOn: 'desc' },
        take: 1,
        select: { performedOn: true, stage: true },
      },
    },
  });

  return units.map((u) => {
    const last = u.cleaningRecords[0] ?? null;
    const result = cleaningStatus(last?.performedOn ?? null, u.cleaningIntervalDays, asOf);
    return {
      productionUnitId: u.id,
      name: u.name,
      siteName: u.site.name,
      intervalDays: u.cleaningIntervalDays,
      lastCleanedOn: last?.performedOn ?? null,
      lastStage: (last?.stage as CleaningStage) ?? null,
      status: result.status,
      days: result.days,
      overdueBy: result.overdueBy,
      sentence: cleaningSentence(result, u.cleaningIntervalDays),
    };
  });
}

export interface CleaningOptions {
  sites: { id: string; name: string }[];
  units: { id: string; name: string; siteId: string }[];
  /** Disinfectants and the like, from the item catalogue. */
  products: { id: string; name: string; sku: string; unitKey: string; dimension: string }[];
  stores: { id: string; name: string; siteId: string }[];
}

/** Everything the form needs to offer. */
export async function cleaningOptions(principal: Principal): Promise<CleaningOptions> {
  const [sites, units, products, stores] = await Promise.all([
    db.site.findMany({
      where: { ...orgFilter(principal), ...siteIdFilter(principal), isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    db.productionUnit.findMany({
      where: { site: { ...orgFilter(principal), ...siteIdFilter(principal) }, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, siteId: true },
    }),
    // Disinfectants first, but not ONLY disinfectants: a farm that records
    // caustic soda or a detergent under another category should still be able
    // to say what it used, and a filtered list would quietly make that
    // impossible.
    db.item.findMany({
      where: { organisationId: principal.organisationId, isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, sku: true, stockUom: { select: { key: true, dimension: true } } },
    }),
    db.stockLocation.findMany({
      where: { site: { ...orgFilter(principal), ...siteIdFilter(principal) }, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, siteId: true },
    }),
  ]);

  return {
    sites,
    units,
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      unitKey: p.stockUom.key,
      dimension: p.stockUom.dimension,
    })),
    stores,
  };
}

export interface RecordedCleaning {
  id: string;
  /** What left the store, said in words. Null when nothing did. */
  stockNote: string | null;
}

/**
 * Write a cleaning record, and take the product off the store if one was named.
 *
 * ONE TRANSACTION. A disinfectant that was used but never left the store leaves
 * the room saying it holds bottles that are empty, and the discrepancy only
 * surfaces when somebody counts.
 *
 * BUT THE RECORD IS NOT LOST TO A STOCK PROBLEM. If the store cannot supply
 * what was used — the shortfall is real, somebody took it without recording it
 * — the issue is still made and reported. `issueFromStock` already takes what
 * it can and reports the shortfall rather than refusing, which is the right
 * behaviour here: the cleaning happened whatever the store thinks.
 */
export async function recordCleaning(
  principal: Principal,
  input: CleaningInput,
): Promise<RecordedCleaning> {
  const site = await db.site.findFirst({
    where: { id: input.siteId, ...orgFilter(principal) },
    select: { id: true },
  });
  if (!site) throw new CleaningError('That farm no longer exists.');
  if (!canAccessSite(principal, site.id)) {
    throw new CleaningError('That is a farm you do not cover.');
  }

  if (input.productionUnitId) {
    const unit = await db.productionUnit.findFirst({
      where: { id: input.productionUnitId, siteId: site.id },
      select: { id: true },
    });
    if (!unit) throw new CleaningError('That house is not at this farm.');
  }

  let product: { id: string; unitKey: string; dimension: Dimension; name: string } | null = null;
  if (input.itemId) {
    const item = await db.item.findFirst({
      where: { id: input.itemId, organisationId: principal.organisationId, isActive: true },
      select: { id: true, name: true, stockUom: { select: { key: true, dimension: true } } },
    });
    if (!item) throw new CleaningError('That product is no longer in the catalogue.');
    product = {
      id: item.id,
      name: item.name,
      unitKey: item.stockUom.key,
      dimension: item.stockUom.dimension as Dimension,
    };
  }

  // Converted from the unit the storekeeper reads to the dimension's base unit,
  // which is what the ledger stores. Getting this wrong by a factor of the
  // container size is a mistake this codebase has already made once, in
  // production stock, and it is invisible until somebody counts the shelf.
  const quantityBase =
    product && input.quantity !== null ? toBase(input.quantity, product.unitKey) : null;

  return db.$transaction(async (tx) => {
    const record = await tx.cleaningRecord.create({
      data: {
        siteId: site.id,
        scope: input.scope,
        productionUnitId: input.scope === 'PRODUCTION_UNIT' ? input.productionUnitId : null,
        areaName: input.scope === 'PRODUCTION_UNIT' ? null : input.areaName,
        stage: input.stage,
        performedOn: input.performedOn,
        performedBy: input.performedBy,
        itemId: product?.id ?? null,
        quantityBase,
        dilution: input.dilution,
        contactTimeMinutes: input.contactTimeMinutes,
        notes: input.notes,
        recordedById: principal.userId,
      },
      select: { id: true },
    });

    let stockNote: string | null = null;
    if (product && quantityBase !== null && input.stockLocationId) {
      stockNote = await issueProduct(
        tx,
        principal,
        record.id,
        product,
        quantityBase,
        input.stockLocationId,
        input.performedOn,
      );
    }

    return { id: record.id, stockNote };
  });
}

async function issueProduct(
  tx: Prisma.TransactionClient,
  principal: Principal,
  recordId: string,
  product: { id: string; name: string; dimension: Dimension },
  quantityBase: number,
  stockLocationId: string,
  occurredOn: Date,
): Promise<string> {
  try {
    const issued = await issueFromStock(tx, principal, {
      itemId: product.id,
      stockLocationId,
      quantityBase,
      unitKey: BASE_UNIT[product.dimension],
      occurredOn,
      notes: 'Used for cleaning',
      sourceType: 'cleaningRecord',
      sourceId: recordId,
    });

    const short =
      issued.shortfallBase > 0
        ? ` The store was ${issued.shortfallBase} short of that, so it now reads zero — check what left without being recorded.`
        : '';

    return `${issued.issuedBase} ${BASE_UNIT[product.dimension]} of ${product.name} taken from the store.${short}`;
  } catch (error) {
    // The cleaning happened whether or not the store can account for the
    // product. Recording the work is the point; the store discrepancy is
    // reported so somebody can look at it.
    if (error instanceof StockMovementError) {
      return `The record is saved, but the store could not be adjusted: ${error.message}`;
    }
    throw error;
  }
}

/** Set or clear how often a place should be cleaned. */
export async function setCleaningInterval(
  principal: Principal,
  productionUnitId: string,
  days: number | null,
): Promise<{ name: string; before: number | null }> {
  const unit = await db.productionUnit.findFirst({
    where: { id: productionUnitId, site: { ...orgFilter(principal) } },
    select: { id: true, name: true, siteId: true, cleaningIntervalDays: true },
  });
  if (!unit) throw new CleaningError('That house no longer exists.');
  if (!canAccessSite(principal, unit.siteId)) {
    throw new CleaningError('That house is at a farm you do not cover.');
  }

  await db.productionUnit.update({
    where: { id: unit.id },
    data: { cleaningIntervalDays: days },
  });
  return { name: unit.name, before: unit.cleaningIntervalDays };
}
