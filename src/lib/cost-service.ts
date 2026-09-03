import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, siteFilter } from '@/lib/scope';
import { productionStartFrom, type CostCategory } from '@/lib/flock-costing';
import {
  birdDaysBetween,
  splitAllocation,
  entryDescription,
  type AllocationMethod,
  type AllocationTarget,
  type AllocationLine,
} from '@/lib/cost-allocation';
import type { PopulationEvent } from '@/lib/ledger';

/**
 * Cost entry & allocation — ADRAH Farms
 *
 * The database side of src/lib/cost-allocation.ts. That module decides how a
 * shared cost is divided; this one supplies the numbers it divides by, and
 * writes the result.
 *
 * WRITES ARE ALL-OR-NOTHING. An allocation and its per-flock entries go in one
 * transaction. A bill that lands on two of three flocks because a connection
 * dropped halfway is a discrepancy nobody would find until the flock was closed
 * and the arithmetic did not work.
 */

export class CostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CostError';
  }
}

export interface FlockOption {
  flockId: string;
  code: string;
  houseName: string | null;
  siteName: string;
  label: string;
  /** Bird-days across the period asked for. */
  birdDays: number;
  /** Birds alive on the date of the cost. */
  headcount: number;
  dateOfHatch: Date;
  closedAt: Date | null;
}

/**
 * The flocks a cost could be charged to, with both weights already worked out.
 *
 * CLOSED FLOCKS ARE INCLUDED when they were alive during the period. A wage
 * bill for July, entered in August after a flock was sold, still belongs partly
 * to that flock — and leaving it out would quietly move its share onto the
 * flocks that happen to still be open, flattering them.
 *
 * The whole event ledger for each flock is read rather than a windowed slice:
 * bird-days on day one of the window depends on every placement and death
 * BEFORE it, so a `where occurredOn >= from` would return a population of zero
 * for every flock placed before the period started.
 */
export async function allocationCandidates(
  principal: Principal,
  options: { periodStart: Date; periodEnd: Date; onDate: Date },
): Promise<FlockOption[]> {
  const flocks = await db.animalGroup.findMany({
    where: {
      site: orgFilter(principal),
      ...siteFilter(principal),
      dateOfHatch: { lte: options.periodEnd },
      OR: [{ closedAt: null }, { closedAt: { gte: options.periodStart } }],
    },
    select: {
      id: true,
      code: true,
      dateOfHatch: true,
      closedAt: true,
      productionUnit: { select: { name: true } },
      site: { select: { name: true } },
      events: { select: { type: true, delta: true, occurredOn: true } },
    },
    orderBy: { dateOfHatch: 'desc' },
  });

  return flocks.map((f) => {
    const events = f.events as PopulationEvent[];
    const houseName = f.productionUnit?.name ?? null;
    return {
      flockId: f.id,
      code: f.code,
      houseName,
      siteName: f.site.name,
      label: houseName ?? f.code,
      birdDays: birdDaysBetween(events, options.periodStart, options.periodEnd),
      headcount: Math.max(
        0,
        events.reduce(
          (sum, e) => (e.occurredOn <= endOfDay(options.onDate) ? sum + e.delta : sum),
          0,
        ),
      ),
      dateOfHatch: f.dateOfHatch,
      closedAt: f.closedAt,
    };
  });
}

export interface RecordAllocationInput {
  category: CostCategory;
  totalPesewas: number;
  incurredOn: Date;
  description: string;
  reference?: string | null;
  method: AllocationMethod;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  targets: AllocationTarget[];
}

export interface RecordedAllocation {
  allocationId: string;
  lines: AllocationLine[];
}

/**
 * Write a cost and its split.
 *
 * The flock ids are re-checked against this principal's scope INSIDE the write,
 * not trusted from the form. A hidden input naming a flock at another site is
 * one line of browser console away, and site scoping that only happens when the
 * page renders the checkboxes is not site scoping.
 */
export async function recordAllocation(
  principal: Principal,
  input: RecordAllocationInput,
): Promise<RecordedAllocation> {
  const flockIds = input.targets.map((t) => t.flockId);

  const permitted = await db.animalGroup.findMany({
    where: { id: { in: flockIds }, site: orgFilter(principal), ...siteFilter(principal) },
    select: { id: true },
  });
  if (permitted.length !== flockIds.length) {
    throw new CostError('One of those flocks is not yours to charge.');
  }

  const lines = splitAllocation(input.totalPesewas, input.method, input.targets);

  return db.$transaction(async (tx) => {
    const allocation = await tx.costAllocation.create({
      data: {
        organisationId: principal.organisationId,
        category: input.category,
        amountPesewas: input.totalPesewas,
        incurredOn: input.incurredOn,
        description: input.description,
        reference: input.reference ?? null,
        method: input.method,
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        recordedById: principal.userId,
      },
    });

    // A line worth nothing is not written. A zero-pesewa cost entry on a flock
    // that carried none of the bill reads, months later, as "this flock's share
    // of the wages was free" — which is a different and wrong claim.
    await tx.flockCostEntry.createMany({
      data: lines
        .filter((l) => l.pesewas !== 0)
        .map((l) => ({
          animalGroupId: l.flockId,
          category: input.category,
          amountPesewas: l.pesewas,
          incurredOn: input.incurredOn,
          description: entryDescription(input.description, input.method, lines.length),
          allocationId: allocation.id,
          allocationWeight: l.weight,
          sourceType: 'costAllocation',
          sourceId: allocation.id,
          recordedById: principal.userId,
        })),
    });

    return { allocationId: allocation.id, lines };
  });
}

/**
 * Undo a cost by writing its opposite.
 *
 * NOTHING IS EDITED AND NOTHING IS DELETED. The reversal mirrors every entry of
 * the original with the sign flipped, so the two sum to nothing and the ledger
 * keeps both the mistake and the correction, in the order they happened. That is
 * the same rule the population ledger follows, for the same reason: a farm that
 * can quietly rewrite what it spent cannot later prove what it spent.
 *
 * The mirror is of the ENTRIES, not a fresh calculation. Re-running the split
 * today could land on different numbers — a mortality correction entered since
 * would change the bird-days — and a reversal that does not exactly cancel is
 * worse than none.
 */
export async function reverseAllocation(
  principal: Principal,
  allocationId: string,
  reason: string,
): Promise<string> {
  const original = await db.costAllocation.findFirst({
    where: { id: allocationId, ...orgFilter(principal) },
    include: { entries: true, reversedBy: { select: { id: true } } },
  });

  if (!original) throw new CostError('That cost no longer exists.');
  if (original.reversedBy) throw new CostError('That cost has already been reversed.');
  if (original.reversesId) throw new CostError('A reversal cannot itself be reversed.');

  return db.$transaction(async (tx) => {
    const reversal = await tx.costAllocation.create({
      data: {
        organisationId: principal.organisationId,
        category: original.category,
        amountPesewas: -original.amountPesewas,
        incurredOn: original.incurredOn,
        description: `Reversal: ${original.description} — ${reason}`,
        reference: original.reference,
        method: original.method,
        periodStart: original.periodStart,
        periodEnd: original.periodEnd,
        reversesId: original.id,
        recordedById: principal.userId,
      },
    });

    await tx.flockCostEntry.createMany({
      data: original.entries.map((e) => ({
        animalGroupId: e.animalGroupId,
        category: e.category,
        amountPesewas: -e.amountPesewas,
        incurredOn: e.incurredOn,
        description: `Reversal: ${e.description ?? original.description}`,
        allocationId: reversal.id,
        allocationWeight: e.allocationWeight,
        sourceType: 'costAllocation',
        sourceId: reversal.id,
        recordedById: principal.userId,
      })),
    });

    return reversal.id;
  });
}

export interface AllocationSummary {
  id: string;
  category: CostCategory;
  amountPesewas: number;
  incurredOn: Date;
  description: string;
  reference: string | null;
  method: AllocationMethod;
  periodStart: Date | null;
  periodEnd: Date | null;
  flockCount: number;
  recordedByName: string;
  createdAt: Date;
  /** Set when this row cancels another. */
  reversesId: string | null;
  /** Set when another row cancels this one. */
  reversedById: string | null;
}

/** Costs entered by hand, newest first. */
export async function listAllocations(
  principal: Principal,
  limit = 50,
): Promise<AllocationSummary[]> {
  const rows = await db.costAllocation.findMany({
    where: orgFilter(principal),
    orderBy: [{ incurredOn: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    include: {
      recordedBy: { select: { name: true } },
      reversedBy: { select: { id: true } },
      _count: { select: { entries: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    category: r.category as CostCategory,
    amountPesewas: r.amountPesewas,
    incurredOn: r.incurredOn,
    description: r.description,
    reference: r.reference,
    method: r.method as AllocationMethod,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    flockCount: r._count.entries,
    recordedByName: r.recordedBy.name,
    createdAt: r.createdAt,
    reversesId: r.reversesId,
    reversedById: r.reversedBy?.id ?? null,
  }));
}

/** One cost, with the split it produced. */
export async function allocationById(principal: Principal, allocationId: string) {
  const row = await db.costAllocation.findFirst({
    where: { id: allocationId, ...orgFilter(principal) },
    include: {
      recordedBy: { select: { name: true } },
      reverses: { select: { id: true, description: true } },
      reversedBy: { select: { id: true, description: true, createdAt: true } },
      entries: {
        include: {
          animalGroup: {
            select: { id: true, code: true, productionUnit: { select: { name: true } } },
          },
        },
        orderBy: { amountPesewas: 'desc' },
      },
    },
  });
  if (!row) return null;

  return {
    ...row,
    category: row.category as CostCategory,
    method: row.method as AllocationMethod,
    lines: row.entries.map((e) => ({
      flockId: e.animalGroupId,
      label: e.animalGroup.productionUnit?.name ?? e.animalGroup.code,
      code: e.animalGroup.code,
      pesewas: e.amountPesewas,
      weight: e.allocationWeight,
    })),
  };
}

/**
 * Everything one flock has cost, as the rows the costing module works on.
 *
 * Read here rather than in src/lib/flock-costing.ts so that module stays pure
 * and testable without a database. This is the only place the two meet.
 */
export async function costEntriesFor(
  principal: Principal,
  flockId: string,
): Promise<
  {
    id: string;
    category: CostCategory;
    amountPesewas: number;
    incurredOn: Date;
    description: string | null;
    sourceType: string | null;
    allocationId: string | null;
  }[]
> {
  const flock = await db.animalGroup.findFirst({
    where: { id: flockId, site: orgFilter(principal), ...siteFilter(principal) },
    select: { id: true },
  });
  if (!flock) return [];

  const rows = await db.flockCostEntry.findMany({
    where: { animalGroupId: flockId },
    orderBy: [{ incurredOn: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      category: true,
      amountPesewas: true,
      incurredOn: true,
      description: true,
      sourceType: true,
      allocationId: true,
    },
  });

  return rows.map((r) => ({ ...r, category: r.category as CostCategory }));
}

export interface PointOfLayContext {
  /** The day the flock started producing, from its own stage history. */
  occurredOn: Date;
  ageDays: number | null;
  /** Birds alive on that day, from the population ledger. */
  pulletsAtStart: number;
}

/**
 * When this flock came into production, and how many birds were alive that day.
 *
 * The stage is identified by LifecycleStage.isProductionStart on the flock's own
 * production type, so nothing in this file — or in flock-costing.ts — knows what
 * a laying hen is. A broiler profile marks no stage, and this returns null.
 *
 * The headcount is derived from the ledger AT THAT DATE rather than read from
 * today's population. Between coming into lay and now, birds die; dividing the
 * rearing cost by today's smaller number would inflate the cost of a pullet by
 * charging it for losses that happened after it became one.
 */
export async function pointOfLayFor(
  principal: Principal,
  flockId: string,
): Promise<PointOfLayContext | null> {
  const flock = await db.animalGroup.findFirst({
    where: { id: flockId, site: orgFilter(principal), ...siteFilter(principal) },
    select: {
      productionType: {
        select: {
          lifecycleStages: {
            where: { isProductionStart: true },
            select: { id: true },
          },
        },
      },
      events: {
        select: { type: true, delta: true, occurredOn: true, toStageId: true, ageDays: true },
      },
    },
  });
  if (!flock) return null;

  const stageIds = flock.productionType.lifecycleStages.map((s) => s.id);
  const start = productionStartFrom(
    flock.events
      .filter((e) => e.type === 'STAGE_CHANGE')
      .map((e) => ({ toStageId: e.toStageId, occurredOn: e.occurredOn, ageDays: e.ageDays })),
    stageIds,
  );
  if (!start) return null;

  const pulletsAtStart = Math.max(
    0,
    flock.events.reduce(
      (sum, e) => (e.occurredOn <= endOfDay(start.occurredOn) ? sum + e.delta : sum),
      0,
    ),
  );

  return { ...start, pulletsAtStart };
}

/** The farm's last recorded quote for a ready-to-lay pullet. Null until entered. */
export async function pulletMarketPrice(principal: Principal): Promise<{
  pesewas: number;
  quotedOn: Date;
  source: string | null;
} | null> {
  const org = await db.organisation.findUnique({
    where: { id: principal.organisationId },
    select: {
      pulletMarketPricePesewas: true,
      pulletMarketPriceOn: true,
      pulletMarketPriceSource: true,
    },
  });

  // Both the figure AND its date are required. A price with no date cannot be
  // reported honestly, and reporting it without saying how old it is would be
  // exactly the stale-figure-as-fact problem the field exists to avoid.
  if (!org?.pulletMarketPricePesewas || !org.pulletMarketPriceOn) return null;

  return {
    pesewas: org.pulletMarketPricePesewas,
    quotedOn: org.pulletMarketPriceOn,
    source: org.pulletMarketPriceSource,
  };
}

function endOfDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999),
  );
}
