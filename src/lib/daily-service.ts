import 'server-only';
import { db } from '@/lib/db';
import { recordEventWithin, FlockError } from '@/lib/flock-service';
import { checkDailyRecord, thresholdsFrom, type Warning } from '@/lib/daily-checks';
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
    observations: string | null;
    recordedBy: string;
    verifiedBy: string | null;
    warnings: Warning[];
  } | null;
  /** Yesterday's figures, shown as faint hints so anomalies stand out. */
  previous: {
    onDate: Date;
    mortality: number;
    feedKg: number | null;
    waterLitres: number | null;
  } | null;
  thresholds: ReturnType<typeof thresholdsFrom>;
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
            observations: existingRecord.observations,
            recordedBy: existingRecord.recordedBy.name,
            verifiedBy: existingRecord.verifiedBy?.name ?? null,
            warnings: Array.isArray(existingRecord.warnings)
              ? (existingRecord.warnings as unknown as Warning[])
              : [],
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
  };
}

export type SubmitResult =
  | { status: 'saved'; recordId: string }
  | { status: 'needsConfirmation'; warnings: Warning[] }
  | { status: 'error'; message: string };

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
      previous: context.previous,
    },
    context.thresholds,
  );

  if (warnings.length > 0 && !input.acknowledgeWarnings) {
    return { status: 'needsConfirmation', warnings };
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
