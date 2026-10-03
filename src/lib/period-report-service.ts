import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, siteFilter } from '@/lib/scope';
import { pesewas, ZERO, type Pesewas } from '@/lib/money';
import { round, ageInDays } from '@/lib/metrics';
import { populationSeries, type PopulationEvent } from '@/lib/ledger';
import { isLive } from '@/lib/dispatch';
import { lineTotal } from '@/lib/sales';
import {
  EMPTY_FIGURES,
  type Period,
  type PeriodFigures,
} from '@/lib/period-report';

/**
 * The period report service — ADRAH Farms
 *
 * EVERY FIGURE IS ADDED UP FROM A LEDGER, NOT READ FROM A TOTAL.
 *
 * There are no reporting tables here and no nightly rollups. The stock ledger,
 * the population ledger, the production records and the dispatch rows are each
 * queried for the period and summed. That is slower than a cached total, and it
 * is the only version that cannot quietly disagree with the rows underneath it —
 * which is the entire reason the report exists: it is trying to CATCH a
 * disagreement, and a report built on cached totals would be checking a cache
 * against itself.
 *
 * If this ever becomes slow enough to matter, the answer is an index, then a
 * materialised view that is rebuilt from these same queries and labelled as a
 * cache — the pattern AnimalGroupSnapshot already follows. It is not to start
 * storing running totals.
 *
 * READS NOTHING ABOUT MONEY RECEIVED, because nothing records it.
 */

const DAY = 86_400_000;

/** Base units of produce a site's store holds, up to and including a day. */
async function produceOnHand(
  itemIds: string[],
  stockLocationIds: string[],
  asOf: Date,
): Promise<number> {
  if (itemIds.length === 0 || stockLocationIds.length === 0) return 0;
  const sum = await db.stockMovement.aggregate({
    where: {
      itemId: { in: itemIds },
      stockLocationId: { in: stockLocationIds },
      occurredOn: { lte: asOf },
    },
    _sum: { deltaBase: true },
  });
  return round(sum._sum.deltaBase ?? 0, 2) ?? 0;
}

/**
 * Which items hold this farm's produce, and which stores hold them.
 *
 * DERIVED FROM THE GRADE LINKS, not from a list somebody maintains. A grade that
 * was linked to an item last month is the reason eggs are in the store at all,
 * and reading the same link here means the report cannot disagree with what put
 * them there.
 */
async function produceScope(principal: Principal) {
  const [grades, locations] = await Promise.all([
    db.productionGrade.findMany({
      where: {
        itemId: { not: null },
        productionType: { speciesProfile: { organisationId: principal.organisationId } },
      },
      select: { itemId: true, isSaleable: true },
    }),
    db.stockLocation.findMany({
      where: {
        receivesProduction: true,
        isActive: true,
        site: { ...orgFilter(principal), ...(principal.siteScope.length > 0 ? { id: { in: principal.siteScope } } : {}) },
      },
      select: { id: true },
    }),
  ]);

  return {
    itemIds: grades.map((g) => g.itemId!).filter(Boolean),
    stockLocationIds: locations.map((l) => l.id),
  };
}

export async function figuresFor(
  principal: Principal,
  period: Period,
): Promise<PeriodFigures> {
  const { itemIds, stockLocationIds } = await produceScope(principal);
  const dayBefore = new Date(period.from.getTime() - DAY);

  const [
    lines,
    movements,
    dispatches,
    events,
    openingBirds,
    openingStock,
    closingStock,
    feed,
  ] = await Promise.all([
    // --- production: collections in the period, by grade -------------------
    db.productionLine.findMany({
      where: {
        record: {
          onDate: { gte: period.from, lte: period.to },
          animalGroup: { site: orgFilter(principal), ...siteFilter(principal) },
        },
      },
      select: {
        quantityBase: true,
        grade: { select: { isSaleable: true, itemId: true } },
      },
    }),

    // --- the store: what moved, and why ------------------------------------
    itemIds.length > 0 && stockLocationIds.length > 0
      ? db.stockMovement.groupBy({
          by: ['type'],
          where: {
            itemId: { in: itemIds },
            stockLocationId: { in: stockLocationIds },
            occurredOn: { gte: period.from, lte: period.to },
          },
          _sum: { deltaBase: true },
        })
      : Promise.resolve([] as { type: string; _sum: { deltaBase: number | null } }[]),

    // --- what went out, and what it was agreed at --------------------------
    db.dispatch.findMany({
      where: {
        ...orgFilter(principal),
        ...siteFilter(principal),
        dispatchedOn: { gte: period.from, lte: period.to },
      },
      select: {
        reversedAt: true,
        lines: {
          select: {
            quantity: true,
            product: { select: { unitsPerPack: true } },
            salesOrderLine: { select: { quantity: true, unitPricePesewas: true } },
          },
        },
      },
    }),

    // --- birds lost --------------------------------------------------------
    db.animalGroupEvent.groupBy({
      by: ['type'],
      where: {
        animalGroup: { site: orgFilter(principal), ...siteFilter(principal) },
        occurredOn: { gte: period.from, lte: period.to },
        type: { in: ['MORTALITY', 'CULL'] },
      },
      _sum: { delta: true },
    }),

    // --- birds at the start ------------------------------------------------
    db.animalGroupEvent.aggregate({
      where: {
        animalGroup: { site: orgFilter(principal), ...siteFilter(principal) },
        occurredOn: { lte: dayBefore },
      },
      _sum: { delta: true },
    }),

    produceOnHand(itemIds, stockLocationIds, dayBefore),
    produceOnHand(itemIds, stockLocationIds, period.to),

    // --- feed issued to houses ---------------------------------------------
    db.flockCostEntry.aggregate({
      where: {
        animalGroup: { site: orgFilter(principal), ...siteFilter(principal) },
        category: 'FEED',
        incurredOn: { gte: period.from, lte: period.to },
      },
      _sum: { amountPesewas: true },
    }),
  ]);

  // --- production -----------------------------------------------------------
  let collected = 0;
  let saleable = 0;
  // Only grades LINKED TO A STORE ITEM can be checked against the store. See
  // reconcile() — counting cracked eggs here would report a gap every day.
  let collectedHeld = 0;
  for (const line of lines) {
    collected += line.quantityBase;
    if (line.grade.isSaleable) saleable += line.quantityBase;
    if (line.grade.itemId) collectedHeld += line.quantityBase;
  }

  // --- the store ------------------------------------------------------------
  const sumOf = (...types: string[]) =>
    movements
      .filter((m) => types.includes(m.type as string))
      .reduce((n, m) => n + (m._sum.deltaBase ?? 0), 0);

  // PRODUCTION is the only movement that puts produce in. RETURN puts back what
  // a reversed load took out, so it belongs on the same side of the sum — a
  // reversal is not a collection, but it is produce arriving in the store.
  const intoStore = round(sumOf('PRODUCTION', 'RETURN'), 2) ?? 0;
  // Signed negative in the ledger; reported as a positive quantity that left.
  const outOfStore = round(Math.abs(sumOf('SALE')), 2) ?? 0;
  const wasted = round(Math.abs(sumOf('DAMAGE', 'EXPIRY')), 2) ?? 0;

  // --- loads ----------------------------------------------------------------
  let dispatched = 0;
  let agreed = 0;
  let loads = 0;
  for (const dispatch of dispatches) {
    if (!isLive(dispatch)) continue;
    loads += 1;
    for (const line of dispatch.lines) {
      dispatched += line.quantity * line.product.unitsPerPack;
      /**
       * WHAT THE LOAD WAS WORTH, AT THE PRICE ON THE ORDER LINE.
       *
       * The price is taken from the order line the load was against, not from
       * today's price list — the same discipline as the invoice. A line added at
       * the gate with no order line behind it contributes produce and no money,
       * which is correct: nobody agreed a price for it.
       */
      if (line.salesOrderLine) {
        agreed += lineTotal({
          quantity: line.quantity,
          unitPricePesewas: pesewas(line.salesOrderLine.unitPricePesewas),
        });
      }
    }
  }

  // --- birds ----------------------------------------------------------------
  const deaths = Math.abs(
    events.find((e) => e.type === 'MORTALITY')?._sum.delta ?? 0,
  );
  const culls = Math.abs(events.find((e) => e.type === 'CULL')?._sum.delta ?? 0);
  const opening = openingBirds._sum.delta ?? 0;

  const closingBirdsSum = await db.animalGroupEvent.aggregate({
    where: {
      animalGroup: { site: orgFilter(principal), ...siteFilter(principal) },
      occurredOn: { lte: period.to },
    },
    _sum: { delta: true },
  });

  // --- feed -----------------------------------------------------------------
  const feedPesewas = pesewas(feed._sum.amountPesewas ?? 0);
  const feedKg = await feedKilograms(principal, period);

  return {
    ...EMPTY_FIGURES,
    collected: round(collected, 2) ?? 0,
    saleable: round(saleable, 2) ?? 0,
    collectedHeld: round(collectedHeld, 2) ?? 0,
    intoStore,
    outOfStore,
    wasted,
    openingStock,
    closingStock,
    dispatched: round(dispatched, 2) ?? 0,
    agreedPesewas: pesewas(agreed) as Pesewas,
    loads,
    openingBirds: opening,
    closingBirds: closingBirdsSum._sum.delta ?? 0,
    deaths,
    culls,
    feedKg,
    feedPesewas,
  };
}

/**
 * Kilograms of feed issued to houses in the period.
 *
 * Read from the STOCK ledger rather than from the cost ledger, because the two
 * answer different questions: the cost ledger says what it was worth, and a
 * batch with no price on it costs nothing while still being feed a bird ate.
 */
async function feedKilograms(principal: Principal, period: Period): Promise<number> {
  const sum = await db.stockMovement.aggregate({
    where: {
      type: 'ISSUE',
      occurredOn: { gte: period.from, lte: period.to },
      item: { organisationId: principal.organisationId, category: 'FEED' },
      stockLocation: {
        site: {
          ...orgFilter(principal),
          ...(principal.siteScope.length > 0 ? { id: { in: principal.siteScope } } : {}),
        },
      },
    },
    _sum: { deltaBase: true },
  });
  return round(Math.abs(sum._sum.deltaBase ?? 0), 2) ?? 0;
}

/**
 * The stores this farm keeps produce in, for the screen to name.
 *
 * A FARM WITH NO PRODUCE STORE GETS A REPORT THAT SAYS SO rather than one full
 * of zeroes. Zero eggs in a store that does not exist reads as a bad week.
 */
export async function produceStoreNames(principal: Principal): Promise<string[]> {
  const rows = await db.stockLocation.findMany({
    where: {
      receivesProduction: true,
      isActive: true,
      site: {
        ...orgFilter(principal),
        ...(principal.siteScope.length > 0 ? { id: { in: principal.siteScope } } : {}),
      },
    },
    orderBy: { name: 'asc' },
    select: { name: true },
  });
  return rows.map((r) => r.name);
}

export { ZERO };

// ---------------------------------------------------------------------------
// THE DAILY SERIES, FOR EXPORT
// ---------------------------------------------------------------------------

/**
 * One row per house per day, over the period.
 *
 * A DAY WITH NO RECORD IS ABSENT, NOT ZERO. This is the whole reason the export
 * is built from the records rather than from a date range walked day by day: a
 * house nobody visited on Sunday did not collect zero eggs, it was not written
 * down, and a spreadsheet full of invented zeros would drag every average on the
 * farm downwards while looking complete.
 *
 * FOUR QUERIES, NOT ONE PER DAY. The production records, the population events,
 * the feed issues and the flocks are each read once for the whole period, and
 * joined in memory. A loop that queried per day would be hundreds of round trips
 * to draw one file.
 */
export async function dailySeriesFor(
  principal: Principal,
  period: Period,
): Promise<DaySeriesRow[]> {
  const flocks = await db.animalGroup.findMany({
    where: { site: orgFilter(principal), ...siteFilter(principal) },
    select: { id: true, code: true, dateOfHatch: true, productionUnit: { select: { name: true } } },
  });
  if (flocks.length === 0) return [];

  const flockIds = flocks.map((f) => f.id);
  const window = { gte: period.from, lte: period.to };

  const [records, events, feed, grades] = await Promise.all([
    db.productionRecord.findMany({
      where: { animalGroupId: { in: flockIds }, onDate: window },
      select: {
        animalGroupId: true,
        onDate: true,
        countedBase: true,
        lines: { select: { productionGradeId: true, quantityBase: true } },
      },
    }),
    db.animalGroupEvent.findMany({
      where: { animalGroupId: { in: flockIds } },
      select: { animalGroupId: true, type: true, delta: true, occurredOn: true },
    }),
    // FROM THE DAILY SHEET, not from the cost ledger. FlockCostEntry carries
    // what the feed COST and no quantity at all; what somebody in the house
    // actually observed and wrote down is kilograms, and that is the figure a
    // daily series is for.
    db.dailyRecord.findMany({
      where: { animalGroupId: { in: flockIds }, onDate: window, feedKg: { not: null } },
      select: { animalGroupId: true, onDate: true, feedKg: true },
    }),
    db.productionGrade.findMany({ select: { id: true, isSaleable: true } }),
  ]);

  const saleableGrades = new Set(grades.filter((g) => g.isSaleable).map((g) => g.id));

  // Only days something was actually written down for.
  const key = (flockId: string, date: Date) => `${flockId}|${date.toISOString().slice(0, 10)}`;
  const touched = new Map<string, { flockId: string; onDate: Date }>();
  for (const r of records) touched.set(key(r.animalGroupId, r.onDate), {
    flockId: r.animalGroupId,
    onDate: r.onDate,
  });
  for (const e of events) {
    if (e.occurredOn < period.from || e.occurredOn > period.to) continue;
    touched.set(key(e.animalGroupId, e.occurredOn), {
      flockId: e.animalGroupId,
      onDate: e.occurredOn,
    });
  }
  for (const f of feed) touched.set(key(f.animalGroupId, f.onDate), {
    flockId: f.animalGroupId,
    onDate: f.onDate,
  });

  const out: DaySeriesRow[] = [];
  for (const flock of flocks) {
    const days = [...touched.values()]
      .filter((t) => t.flockId === flock.id)
      .map((t) => t.onDate)
      .sort((a, b) => a.getTime() - b.getTime());
    if (days.length === 0) continue;

    const populations = populationSeries(
      events
        .filter((e) => e.animalGroupId === flock.id)
        .map((e) => ({
          type: e.type as PopulationEvent['type'],
          delta: e.delta,
          occurredOn: e.occurredOn,
        })),
      days,
    );

    for (const day of populations) {
      const k = key(flock.id, day.onDate);
      const dayRecords = records.filter((r) => key(r.animalGroupId, r.onDate) === k);
      const dayEvents = events.filter(
        (e) => key(e.animalGroupId, e.occurredOn) === k,
      );

      let collected = 0;
      let saleable = 0;
      for (const record of dayRecords) {
        const graded = record.lines.reduce((sum, l) => sum + l.quantityBase, 0);
        collected += graded > 0 ? graded : (record.countedBase ?? 0);
        saleable += record.lines
          .filter((l) => saleableGrades.has(l.productionGradeId))
          .reduce((sum, l) => sum + l.quantityBase, 0);
      }

      out.push({
        onDate: day.onDate,
        flockCode: flock.productionUnit?.name
          ? `${flock.code} (${flock.productionUnit.name})`
          : flock.code,
        ageDays: ageInDays(flock.dateOfHatch, day.onDate),
        openingBirds: day.opening,
        closingBirds: day.closing,
        deaths: dayEvents.filter((e) => e.type === 'MORTALITY').reduce((s, e) => s - e.delta, 0),
        culls: dayEvents.filter((e) => e.type === 'CULL').reduce((s, e) => s - e.delta, 0),
        collected: round(collected, 2) ?? 0,
        saleable: round(saleable, 2) ?? 0,
        feedKg:
          round(
            feed
              .filter((f) => key(f.animalGroupId, f.onDate) === k)
              .reduce((s, f) => s + (f.feedKg ?? 0), 0),
            2,
          ) ?? 0,
      });
    }
  }

  return out.sort(
    (a, b) => a.onDate.getTime() - b.onDate.getTime() || a.flockCode.localeCompare(b.flockCode),
  );
}

export interface DaySeriesRow {
  onDate: Date;
  flockCode: string;
  ageDays: number;
  openingBirds: number;
  closingBirds: number;
  deaths: number;
  culls: number;
  collected: number;
  saleable: number;
  feedKg: number;
}
