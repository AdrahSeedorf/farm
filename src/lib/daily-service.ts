import 'server-only';
import { db } from '@/lib/db';
import { recordEventWithin, FlockError } from '@/lib/flock-service';
import { issueFeedWithin } from '@/lib/stock-movements';
import { checkFeedIssue } from '@/lib/feed-issue';
import { checkDailyRecord, thresholdsFrom } from '@/lib/daily-checks';
import { warningToken, type Warning } from '@/lib/warnings';
import { broodingCurveFrom, isBroodingAge, broodingTargetC } from '@/lib/rearing';
import { ageInDays } from '@/lib/metrics';
import type { Principal } from '@/lib/rbac';
import type { DailyRecordInput } from '@/lib/validation/daily';

/**
 * Daily record service — ADRAH Farms
 *
 * The morning entry. One screen, one submission, one transaction.
 *
 * WHY THE WHOLE THING IS ONE TRANSACTION
 *   A morning's entry creates a DailyRecord and up to two ledger events. If the
 *   record saved but the mortality event did not, the farm would hold a written
 *   record saying six birds died beside a ledger that never lost them — the
 *   exact disagreement the ledger exists to prevent. All of it lands, or none.
 *
 * WHY A RECORD CANNOT BE EDITED
 *   Once submitted, the mortality is on the ledger and the birds are gone from
 *   the count. "Editing" the day would mean silently reversing ledger events,
 *   which is the one thing the architecture forbids. A mistake is fixed the same
 *   way any other is: a correction on the flock, which appears in the timeline
 *   beside the original.
 */

export interface DailyContext {
  flockId: string;
  code: string;
  houseName: string | null;
  siteId: string;
  population: number;
  ageDays: number;
  stageName: string | null;
  /** Whether a record already exists for the date in question. */
  existing: {
    id: string;
    mortality: number;
    culls: number;
    feedKg: number | null;
    waterLitres: number | null;
    broodTempC: number | null;
    chickBehaviour: string | null;
    litterCondition: string | null;
    observations: string | null;
    recordedBy: string;
    verifiedBy: string | null;
    warnings: Warning[];
    /** What actually left the store for this record, if anything did. */
    feedIssue: {
      itemName: string;
      issuedKg: number;
      batchNumbers: string[];
      costPesewas: number | null;
      /** Drawn from batches with no recorded price — the cost is short by this. */
      uncostedKg: number;
    } | null;
  } | null;
  /** Yesterday's figures, shown as faint hints so anomalies stand out. */
  previous: {
    onDate: Date;
    mortality: number;
    feedKg: number | null;
    waterLitres: number | null;
  } | null;
  thresholds: ReturnType<typeof thresholdsFrom>;
  broodingCurve: ReturnType<typeof broodingCurveFrom>;
  /** Whether this flock still needs the brooding questions asked. */
  isBrooding: boolean;
  broodTargetC: number | null;
  /**
   * Where feed can be drawn from for this flock.
   *
   * Empty when the farm has not set up any stock — and the daily record then
   * behaves exactly as it did before, recording the kilograms and nothing more.
   * Setting up inventory is not a precondition for recording a morning.
   */
  feedSources: {
    items: { id: string; name: string; onHandKg: number }[];
    locations: { id: string; name: string }[];
    /** What this flock was fed last, so tomorrow needs no decision at all. */
    defaultItemId: string | null;
    defaultLocationId: string | null;
  };
}

/**
 * Feed items and stores available to one flock's site, with what is on hand.
 *
 * Restricted to MASS items because the daily record's feed figure is in
 * kilograms. Offering an item counted in pieces would let someone record "40 kg"
 * of egg crates, and the ledger would dutifully store it.
 */
async function feedSourcesFor(
  organisationId: string,
  siteId: string,
  flockId: string,
): Promise<DailyContext['feedSources']> {
  const [locations, items] = await Promise.all([
    db.stockLocation.findMany({
      where: { siteId, isActive: true, site: { organisationId } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    db.item.findMany({
      where: { organisationId, isActive: true, stockUom: { dimension: 'MASS' } },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, category: true },
    }),
  ]);

  if (locations.length === 0 || items.length === 0) {
    return { items: [], locations: [], defaultItemId: null, defaultLocationId: null };
  }

  const locationIds = locations.map((l) => l.id);

  // What this flock was fed last. REMEMBERING BEATS CONFIGURING: after the first
  // morning the pickers are already right, and the day the flock moves from
  // chick mash to grower it is changed once and then stays changed. The
  // alternative — a feed programme configured per lifecycle stage — is a screen
  // nobody fills in, and a default that is silently wrong.
  const recentRecordIds = (
    await db.dailyRecord.findMany({
      where: { animalGroupId: flockId },
      orderBy: { onDate: 'desc' },
      take: 30,
      select: { id: true },
    })
  ).map((r) => r.id);

  const [sums, lastIssue] = await Promise.all([
    db.stockMovement.groupBy({
      by: ['itemId'],
      where: { itemId: { in: items.map((i) => i.id) }, stockLocationId: { in: locationIds } },
      _sum: { deltaBase: true },
    }),
    recentRecordIds.length === 0
      ? null
      : db.stockMovement.findFirst({
          where: {
            type: 'ISSUE',
            sourceType: 'dailyRecord',
            sourceId: { in: recentRecordIds },
          },
          orderBy: { createdAt: 'desc' },
          select: { itemId: true, stockLocationId: true },
        }),
  ]);

  const onHand = new Map(sums.map((s) => [s.itemId, s._sum.deltaBase ?? 0]));

  // Feed first, then anything else weighed — a farm that records molasses or
  // grit through this field should find it, just not before the layer mash.
  const ordered = [...items].sort((a, b) => {
    const rank = (c: string) => (c === 'FEED' ? 0 : 1);
    return rank(a.category) - rank(b.category) || a.name.localeCompare(b.name);
  });

  return {
    items: ordered.map((i) => ({
      id: i.id,
      name: i.name,
      onHandKg: onHand.get(i.id) ?? 0,
    })),
    locations,
    defaultItemId: lastIssue?.itemId ?? ordered.find((i) => (onHand.get(i.id) ?? 0) > 0)?.id ?? null,
    defaultLocationId: lastIssue?.stockLocationId ?? locations[0]?.id ?? null,
  };
}

/** Everything the entry screen needs for one flock, in a handful of queries. */
export async function dailyContextFor(
  flockId: string,
  onDate: Date,
): Promise<DailyContext | null> {
  const flock = await db.animalGroup.findUnique({
    where: { id: flockId },
    include: {
      productionUnit: { select: { name: true } },
      currentStage: { select: { name: true } },
      productionType: { select: { standards: true } },
      site: { select: { organisationId: true } },
    },
  });
  if (!flock) return null;

  const [populationRow, existingRecord, previousRecord] = await Promise.all([
    db.animalGroupEvent.aggregate({
      where: { animalGroupId: flockId },
      _sum: { delta: true },
    }),
    db.dailyRecord.findFirst({
      where: { animalGroupId: flockId, onDate },
      include: {
        recordedBy: { select: { name: true } },
        verifiedBy: { select: { name: true } },
      },
    }),
    db.dailyRecord.findFirst({
      where: { animalGroupId: flockId, onDate: { lt: onDate } },
      orderBy: { onDate: 'desc' },
    }),
  ]);

  // Mortality and culls are not columns — they are read back off the ledger,
  // filtered to the events this record created.
  const eventsFor = async (recordId: string) => {
    const rows = await db.animalGroupEvent.groupBy({
      by: ['type'],
      where: { sourceType: 'dailyRecord', sourceId: recordId },
      _sum: { delta: true },
    });
    const abs = (type: string) =>
      Math.abs(rows.find((r) => r.type === type)?._sum.delta ?? 0);
    return { mortality: abs('MORTALITY'), culls: abs('CULL') };
  };

  const existingCounts = existingRecord ? await eventsFor(existingRecord.id) : null;
  const previousCounts = previousRecord ? await eventsFor(previousRecord.id) : null;

  const [feedSources, existingIssue] = await Promise.all([
    feedSourcesFor(flock.site.organisationId, flock.siteId, flockId),
    existingRecord ? feedIssueFor(existingRecord.id) : null,
  ]);

  const curve = broodingCurveFrom(flock.productionType.standards);
  const age = ageInDays(flock.dateOfHatch, onDate);
  const brooding = isBroodingAge(age, curve);

  return {
    flockId: flock.id,
    code: flock.code,
    houseName: flock.productionUnit?.name ?? null,
    siteId: flock.siteId,
    population: populationRow._sum.delta ?? 0,
    ageDays: ageInDays(flock.dateOfHatch, onDate),
    stageName: flock.currentStage?.name ?? null,
    existing:
      existingRecord && existingCounts
        ? {
            id: existingRecord.id,
            mortality: existingCounts.mortality,
            culls: existingCounts.culls,
            feedKg: existingRecord.feedKg,
            waterLitres: existingRecord.waterLitres,
            broodTempC: existingRecord.broodTempC,
            chickBehaviour: existingRecord.chickBehaviour,
            litterCondition: existingRecord.litterCondition,
            observations: existingRecord.observations,
            recordedBy: existingRecord.recordedBy.name,
            verifiedBy: existingRecord.verifiedBy?.name ?? null,
            warnings: Array.isArray(existingRecord.warnings)
              ? (existingRecord.warnings as unknown as Warning[])
              : [],
            feedIssue: existingIssue,
          }
        : null,
    previous:
      previousRecord && previousCounts
        ? {
            onDate: previousRecord.onDate,
            mortality: previousCounts.mortality,
            feedKg: previousRecord.feedKg,
            waterLitres: previousRecord.waterLitres,
          }
        : null,
    thresholds: thresholdsFrom(flock.productionType.standards),
    broodingCurve: curve,
    isBrooding: brooding,
    broodTargetC: brooding ? broodingTargetC(age, curve) : null,
    feedSources,
  };
}

/**
 * What left the store for one daily record.
 *
 * Read back off the ledger rather than stored on the record, for the same reason
 * mortality is: the movements are the truth, and a second copy on the record
 * would be one more thing that can disagree with them.
 */
async function feedIssueFor(
  recordId: string,
): Promise<NonNullable<DailyContext['existing']>['feedIssue']> {
  const [movements, cost] = await Promise.all([
    db.stockMovement.findMany({
      where: { sourceType: 'dailyRecord', sourceId: recordId, type: 'ISSUE' },
      include: {
        item: { select: { name: true } },
        itemBatch: { select: { batchNumber: true, unitCostPesewas: true } },
      },
    }),
    db.flockCostEntry.aggregate({
      where: { sourceType: 'dailyRecord', sourceId: recordId, category: 'FEED' },
      _sum: { amountPesewas: true },
    }),
  ]);

  if (movements.length === 0) return null;

  return {
    itemName: movements[0].item.name,
    issuedKg: Math.round(movements.reduce((sum, m) => sum - m.deltaBase, 0) * 1000) / 1000,
    batchNumbers: movements
      .map((m) => m.itemBatch?.batchNumber)
      .filter((b): b is string => Boolean(b)),
    costPesewas: cost._sum.amountPesewas,
    uncostedKg:
      Math.round(
        movements
          .filter((m) => m.itemBatch?.unitCostPesewas === null || m.itemBatch === null)
          .reduce((sum, m) => sum - m.deltaBase, 0) * 1000,
      ) / 1000,
  };
}

export type SubmitResult =
  | { status: 'saved'; recordId: string }
  | { status: 'needsConfirmation'; warnings: Warning[]; token: string }
  | { status: 'error'; message: string };

/**
 * A fingerprint of exactly which warnings were shown.
 *
 * WHY A TOKEN AND NOT A BOOLEAN.
 *   A plain "I have seen the warnings" checkbox stays ticked. Correct the
 *   mortality figure, mistype the feed instead, and the form submits with the
 *   old acknowledgement still attached — saving a brand-new problem that was
 *   never displayed to anyone.
 *
 *   Tying the acknowledgement to the CONTENT means it only covers the warnings
 *   the person actually read. Change the entry, and any new warning has to be
 *   shown and accepted on its own terms.
 */
// `warningToken` is implemented in `warnings.ts` so the receipt form and the
// daily record cannot drift into two different fingerprints of the same idea.
// A drifted fingerprint fails OPEN: it accepts warnings nobody was shown.

/**
 * Work out whether this morning's feed can come off the store, and what to warn.
 *
 * Returns no issue at all when the farm has not chosen a source — the daily
 * record then works exactly as it did before inventory existed. That is
 * deliberate: setting up a store is a good idea, and it is not a precondition
 * for writing down that six birds died.
 */
async function planFeedIssue(
  input: DailyRecordInput,
  context: DailyContext,
): Promise<{
  warnings: Warning[];
  issue: { itemId: string; stockLocationId: string; quantityKg: number } | null;
}> {
  if (!input.feedKg || input.feedKg <= 0) return { warnings: [], issue: null };
  if (!input.feedItemId || !input.feedStockLocationId) return { warnings: [], issue: null };

  const item = context.feedSources.items.find((i) => i.id === input.feedItemId);
  const location = context.feedSources.locations.find((l) => l.id === input.feedStockLocationId);
  if (!item || !location) {
    return {
      warnings: [
        {
          field: 'feedKg',
          message:
            'That feed item or store is no longer available, so the feed was recorded ' +
            'without taking it off the store.',
        },
      ],
      issue: null,
    };
  }

  const available = await db.stockMovement.aggregate({
    where: { itemId: item.id, stockLocationId: location.id },
    _sum: { deltaBase: true },
  });

  return {
    warnings: checkFeedIssue({
      requestedBase: input.feedKg,
      availableBase: available._sum.deltaBase ?? 0,
      itemName: item.name,
      storeName: location.name,
    }),
    issue: {
      itemId: item.id,
      stockLocationId: location.id,
      quantityKg: input.feedKg,
    },
  };
}

/**
 * Submit one morning's record.
 *
 * Returns `needsConfirmation` when a figure looks implausible and the person has
 * not yet confirmed it. Nothing is written in that case — but the warning never
 * becomes a refusal. Confirm, and it saves exactly as entered, along with what
 * was flagged.
 */
export async function submitDailyRecord(
  principal: Principal,
  flockId: string,
  input: DailyRecordInput,
): Promise<SubmitResult> {
  const context = await dailyContextFor(flockId, input.onDate);
  if (!context) return { status: 'error', message: 'That flock no longer exists.' };

  if (context.existing) {
    return {
      status: 'error',
      message: `A record for ${input.onDate.toISOString().slice(0, 10)} already exists, entered by ${context.existing.recordedBy}. Records are never overwritten — record a correction on the flock instead.`,
    };
  }

  const warnings = checkDailyRecord(
    {
      population: context.population,
      ageDays: context.ageDays,
      mortality: input.mortality,
      culls: input.culls,
      feedKg: input.feedKg,
      waterLitres: input.waterLitres,
      // Brooding answers are only meaningful while the flock is brooding.
      broodTempC: context.isBrooding ? input.broodTempC : null,
      chickBehaviour: context.isBrooding ? (input.chickBehaviour ?? null) : null,
      litterCondition: context.isBrooding ? (input.litterCondition ?? null) : null,
      broodingCurve: context.broodingCurve,
      previous: context.previous,
    },
    context.thresholds,
  );

  // Is the store able to cover what was fed? Asked BEFORE the transaction so a
  // shortfall is something the person confirms, not something they discover
  // afterwards — and never something that refuses the record.
  const feedPlan = await planFeedIssue(input, context);
  warnings.push(...feedPlan.warnings);

  if (warnings.length > 0) {
    const token = warningToken(warnings);
    // Only an acknowledgement of THESE warnings counts.
    if (input.acknowledgedToken !== token) {
      return { status: 'needsConfirmation', warnings, token };
    }
  }

  try {
    const recordId = await db.$transaction(async (tx) => {
      const record = await tx.dailyRecord.create({
        data: {
          animalGroupId: flockId,
          productionUnitId: (
            await tx.animalGroup.findUniqueOrThrow({
              where: { id: flockId },
              select: { productionUnitId: true },
            })
          ).productionUnitId!,
          onDate: input.onDate,
          idempotencyKey: input.idempotencyKey,
          feedKg: input.feedKg,
          waterLitres: input.waterLitres,
          broodTempC: context.isBrooding ? input.broodTempC : null,
          chickBehaviour: context.isBrooding ? (input.chickBehaviour ?? null) : null,
          litterCondition: context.isBrooding ? (input.litterCondition ?? null) : null,
          observations: input.observations ?? null,
          warnings: warnings.length > 0 ? JSON.parse(JSON.stringify(warnings)) : undefined,
          recordedById: principal.userId,
        },
        select: { id: true },
      });

      if (input.mortality > 0) {
        await recordEventWithin(tx, principal, {
          animalGroupId: flockId,
          type: 'MORTALITY',
          quantity: input.mortality,
          occurredOn: input.onDate,
          reasonCode: input.mortalityReason ?? null,
          sourceType: 'dailyRecord',
          sourceId: record.id,
        });
      }

      if (input.culls > 0) {
        await recordEventWithin(tx, principal, {
          animalGroupId: flockId,
          type: 'CULL',
          quantity: input.culls,
          occurredOn: input.onDate,
          reasonCode: input.cullReason ?? null,
          sourceType: 'dailyRecord',
          sourceId: record.id,
        });
      }

      // Feed leaves the store in the SAME transaction as the record that says
      // it was fed. Two writes that can disagree are two writes that eventually
      // will.
      if (feedPlan.issue) {
        await issueFeedWithin(tx, principal, {
          itemId: feedPlan.issue.itemId,
          stockLocationId: feedPlan.issue.stockLocationId,
          animalGroupId: flockId,
          quantityKg: feedPlan.issue.quantityKg,
          occurredOn: input.onDate,
          dailyRecordId: record.id,
          flockCode: context.code,
        });
      }

      return record.id;
    });

    return { status: 'saved', recordId };
  } catch (error) {
    if (error instanceof FlockError) return { status: 'error', message: error.message };
    // The idempotency key or the one-record-per-day constraint caught a retry.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return {
        status: 'error',
        message: 'That record has already been saved. Reload the page to see it.',
      };
    }
    throw error;
  }
}
