import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter } from '@/lib/scope';
import { ageInDays } from '@/lib/metrics';
import { warningToken, type Warning } from '@/lib/warnings';
import { terminologyFrom, type Terminology } from '@/lib/terminology';
import {
  checkCollection,
  productionThresholdsFrom,
  pointOfLayAgeFrom,
  type ProductionThresholds,
} from '@/lib/production-checks';
import {
  collectionTotal,
  layStandardFrom,
  standardHenDayAt,
  totalOf,
  type Grade,
  type OutputLine,
} from '@/lib/production';
import { assertSaleAllowed, flockWithdrawals, WithdrawalError } from '@/lib/withdrawal-service';
import type { CollectionInput, ParsedGradeLine } from '@/lib/validation/production';

/**
 * Production service — ADRAH Farms
 *
 * THE ONLY PLACE A ProductionRecord IS WRITTEN. Nothing else calls
 * `db.productionRecord.create`, for the same reason nothing but `flock-service`
 * writes bird events and nothing but `stock-movements` writes the stock ledger:
 * the collection number, the age stamp, the unit conversion and — most of all —
 * the withdrawal gate all live in one place, so none of them can be forgotten at
 * a call site written in a hurry next year.
 *
 * WHERE THE WITHDRAWAL GATE FINALLY BITES
 *   Milestone 7 wrote `assertSaleAllowed` and left it uncalled, because nothing
 *   sold anything yet. This is the first caller.
 *
 *   The rule it enforces is narrow and deliberate: a collection made during a
 *   withdrawal period is ALWAYS recordable — the eggs exist, and hen-day
 *   production does not pause because a flock was treated — but it cannot be
 *   recorded as FIT FOR SALE. That is not the warn-never-block rule being
 *   broken. "Six hundred eggs were collected" is an observation and is always
 *   accepted; "these six hundred eggs may be sold" is a food-safety claim about
 *   the future, and it is false.
 */

export class ProductionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionError';
  }
}

export interface RecordedCollection {
  id: string;
  sequence: number;
  countedBase: number | null;
  gradedBase: number;
  disposition: string;
  dispositionNote: string | null;
  notes: string | null;
  recordedBy: string;
  createdAt: Date;
  correctsId: string | null;
  correctedById: string | null;
  lines: { gradeId: string; gradeName: string; isSaleable: boolean; quantityBase: number }[];
  warnings: Warning[];
}

export interface ProductionContext {
  flockId: string;
  code: string;
  houseName: string | null;
  siteId: string;
  productionUnitId: string | null;
  /** The words this species uses, so no screen has to say "egg" in code. */
  words: Terminology;
  /**
   * Whether this production type records output at all.
   *
   * A broiler flock has no collections; the capability flag on the profile says
   * so, and the screen offers nothing rather than asking a meaningless question.
   */
  recordsProduction: boolean;
  population: number;
  ageDays: number;
  stageName: string | null;
  productionStarted: boolean;
  pointOfLayAgeDays: number | null;
  thresholds: ProductionThresholds;
  /** The breed's published hen-day figure for today, when a curve is loaded. */
  standardHenDayPct: number | null;
  /** Grades currently offered, in the farm's own order. */
  grades: (Grade & { id: string })[];
  /** What has already been recorded for this date. */
  today: {
    collections: RecordedCollection[];
    /** Net of any corrections — the day as it now stands. */
    total: number;
    nextSequence: number;
  };
  /** The whole of the previous day that has any record, for comparison. */
  previous: { onDate: Date; total: number } | null;
  /** Null unless this flock's eggs are under a withdrawal period. */
  eggsClearOn: Date | null;
}

/**
 * Everything the collection screen needs for one flock on one date.
 *
 * Site scoping is NOT applied here — the caller has already established which
 * flock this is and whether the principal may see it. Organisation isolation is,
 * because that is never a caller's judgement to make.
 */
export async function productionContextFor(
  principal: Principal,
  flockId: string,
  onDate: Date,
): Promise<ProductionContext | null> {
  const flock = await db.animalGroup.findFirst({
    where: { id: flockId, site: orgFilter(principal) },
    include: {
      productionUnit: { select: { id: true, name: true } },
      currentStage: { select: { name: true, isProductionStart: true } },
      breedRef: { select: { standards: true } },
      speciesProfile: { select: { terminology: true } },
      productionType: {
        select: {
          id: true,
          standards: true,
          capabilities: true,
          productionGrades: {
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
          },
        },
      },
    },
  });
  if (!flock) return null;

  const [populationRow, todayRecords, previousRecord, withdrawal] = await Promise.all([
    db.animalGroupEvent.aggregate({
      where: { animalGroupId: flockId },
      _sum: { delta: true },
    }),
    collectionsOn(flockId, onDate),
    db.productionRecord.findFirst({
      where: { animalGroupId: flockId, onDate: { lt: onDate } },
      orderBy: { onDate: 'desc' },
      select: { onDate: true },
    }),
    flockWithdrawals(principal, flockId, onDate),
  ]);

  const previous = previousRecord
    ? {
        onDate: previousRecord.onDate,
        total: totalRecorded(await collectionsOn(flockId, previousRecord.onDate)),
      }
    : null;

  const ageDays = ageInDays(flock.dateOfHatch, onDate);
  const standards = flock.productionType.standards;

  return {
    flockId: flock.id,
    code: flock.code,
    houseName: flock.productionUnit?.name ?? null,
    siteId: flock.siteId,
    productionUnitId: flock.productionUnit?.id ?? null,
    words: terminologyFrom(flock.speciesProfile.terminology),
    recordsProduction: capabilityEnabled(flock.productionType.capabilities, 'eggProduction'),
    population: populationRow._sum.delta ?? 0,
    ageDays,
    stageName: flock.currentStage?.name ?? null,
    // FROM THE FLAG ON THE STAGE, never from a stage key matched in code. See
    // LifecycleStage.isProductionStart — the day this platform carries a second
    // species, "laying" would be the wrong word to look for.
    productionStarted: flock.currentStage?.isProductionStart ?? false,
    pointOfLayAgeDays: pointOfLayAgeFrom(standards),
    thresholds: productionThresholdsFrom(standards),
    standardHenDayPct: standardHenDayAt(ageDays, layStandardFrom(flock.breedRef?.standards)),
    grades: flock.productionType.productionGrades.map((g) => ({
      id: g.id,
      key: g.key,
      name: g.name,
      isSaleable: g.isSaleable,
      sortOrder: g.sortOrder,
    })),
    today: {
      collections: todayRecords,
      total: totalRecorded(todayRecords),
      nextSequence: nextSequenceFrom(todayRecords),
    },
    previous,
    eggsClearOn: withdrawal?.eggsClearOn ?? null,
  };
}

/** Every collection recorded against one flock on one date, oldest first. */
export async function collectionsOn(
  flockId: string,
  onDate: Date,
): Promise<RecordedCollection[]> {
  const records = await db.productionRecord.findMany({
    where: { animalGroupId: flockId, onDate },
    orderBy: { sequence: 'asc' },
    include: {
      recordedBy: { select: { name: true } },
      correctedBy: { select: { id: true } },
      lines: {
        include: { grade: { select: { id: true, name: true, isSaleable: true, sortOrder: true } } },
      },
    },
  });

  return records.map((record) => ({
    id: record.id,
    sequence: record.sequence,
    countedBase: record.countedBase,
    gradedBase: record.lines.reduce((sum, line) => sum + line.quantityBase, 0),
    disposition: record.disposition,
    dispositionNote: record.dispositionNote,
    notes: record.notes,
    recordedBy: record.recordedBy.name,
    createdAt: record.createdAt,
    correctsId: record.correctsId,
    correctedById: record.correctedBy?.id ?? null,
    lines: [...record.lines]
      .sort((a, b) => a.grade.sortOrder - b.grade.sortOrder)
      .map((line) => ({
        gradeId: line.grade.id,
        gradeName: line.grade.name,
        isSaleable: line.grade.isSaleable,
        quantityBase: line.quantityBase,
      })),
    warnings: Array.isArray(record.warnings) ? (record.warnings as unknown as Warning[]) : [],
  }));
}

/**
 * The day's net figure.
 *
 * Corrections are ordinary rows carrying negative quantities, so they subtract
 * themselves simply by being summed. Nothing has to know which rows are
 * corrections in order to get the right answer — which is the same discipline
 * the population ledger uses, and the reason both can be trusted.
 */
export function totalRecorded(records: RecordedCollection[]): number {
  // Through `collectionTotal` rather than repeating its rule — that the house
  // count wins over the graded lines is a decision with reasons behind it, and a
  // second copy of it here would be the copy that eventually disagrees.
  return records.reduce(
    (sum, r) =>
      sum +
      collectionTotal({
        sequence: r.sequence,
        countedQuantity: r.countedBase,
        lines: r.lines.map((l) => ({ gradeKey: l.gradeId, quantity: l.quantityBase })),
      }),
    0,
  );
}

function nextSequenceFrom(records: RecordedCollection[]): number {
  return records.reduce((highest, r) => Math.max(highest, r.sequence), 0) + 1;
}

/** Read a boolean out of a production type's capabilities JSON. */
function capabilityEnabled(capabilities: unknown, key: string): boolean {
  if (!capabilities || typeof capabilities !== 'object') return false;
  return (capabilities as Record<string, unknown>)[key] === true;
}

// ---------------------------------------------------------------------------
// RECORDING
// ---------------------------------------------------------------------------

export type SubmitCollectionResult =
  | { status: 'saved'; recordId: string; sequence: number }
  | { status: 'needsConfirmation'; warnings: Warning[]; token: string }
  | { status: 'error'; message: string };

export interface SubmitCollectionInput extends CollectionInput {
  /** Already parsed and converted to whole pieces — see validation/production.ts. */
  lines: ParsedGradeLine[];
  countedBase: number | null;
}

/**
 * Record one collection.
 *
 * Returns `needsConfirmation` when something looks implausible and the person
 * has not yet accepted it. NOTHING IS WRITTEN in that case — and the warning
 * never becomes a refusal. Confirm, and it saves exactly as entered, with what
 * was flagged stored on the record so a run of odd days can be read back later.
 */
export async function submitCollection(
  principal: Principal,
  flockId: string,
  input: SubmitCollectionInput,
): Promise<SubmitCollectionResult> {
  const context = await productionContextFor(principal, flockId, input.onDate);
  if (!context) return { status: 'error', message: 'That flock no longer exists.' };

  if (input.countedBase === null && input.lines.length === 0) {
    return {
      status: 'error',
      message: 'Nothing was entered. Record what was counted, or how it graded, or both.',
    };
  }

  // THE GATE. Only asked when the claim is actually being made: a collection
  // recorded as held, destroyed or eaten on the farm needs no clearance, and
  // asking for one would refuse an entry that is the correct thing to record.
  //
  // Dated on the day of the COLLECTION, not today. Eggs laid inside a withdrawal
  // window are restricted whether they are entered that evening or a week later.
  if (input.disposition === 'SALEABLE') {
    try {
      await assertSaleAllowed(principal, flockId, 'EGGS', input.onDate);
    } catch (error) {
      if (error instanceof WithdrawalError) {
        return {
          status: 'error',
          message:
            `${error.message} Record the collection as held, destroyed or eaten on the farm — ` +
            `it still happened, and it still belongs in the production figures.`,
        };
      }
      throw error;
    }
  }

  const warnings = checkCollection(
    {
      birdsAlive: context.population,
      ageDays: context.ageDays,
      quantity: input.countedBase ?? totalOf(toOutputLines(input.lines, context)),
      earlierToday: context.today.total,
      lines: toOutputLines(input.lines, context),
      grades: context.grades,
      countedQuantity: input.countedBase,
      productionStarted: context.productionStarted,
      pointOfLayAgeDays: context.pointOfLayAgeDays,
      previousDayTotal: context.previous?.total ?? null,
      standardHenDayPct: context.standardHenDayPct,
      eggsClearOn: context.eggsClearOn,
    },
    context.thresholds,
  );

  if (warnings.length > 0) {
    const token = warningToken(warnings);
    // Only an acknowledgement of THESE warnings counts. A checkbox would stay
    // ticked while the figures changed underneath it.
    if (input.acknowledgedToken !== token) {
      return { status: 'needsConfirmation', warnings, token };
    }
  }

  try {
    const record = await writeCollection(principal, context, input, warnings);
    return { status: 'saved', recordId: record.id, sequence: record.sequence };
  } catch (error) {
    if (error instanceof ProductionError) return { status: 'error', message: error.message };
    if (isUniqueViolation(error)) {
      return {
        status: 'error',
        message: 'That collection has already been saved. Reload the page to see it.',
      };
    }
    throw error;
  }
}

/**
 * The write itself, in one transaction.
 *
 * THE COLLECTION NUMBER IS DECIDED INSIDE THE TRANSACTION, not on the form. A
 * client that chose its own sequence would let two people collecting at the same
 * time overwrite each other, and the unique constraint would turn a perfectly
 * ordinary second collection into an error message. Read inside, written inside,
 * and retried if somebody else took the number first.
 */
async function writeCollection(
  principal: Principal,
  context: ProductionContext,
  input: SubmitCollectionInput,
  warnings: Warning[],
): Promise<{ id: string; sequence: number }> {
  const attempt = () =>
    db.$transaction(async (tx) => {
      const highest = await tx.productionRecord.aggregate({
        where: { animalGroupId: context.flockId, onDate: input.onDate },
        _max: { sequence: true },
      });
      const sequence = (highest._max.sequence ?? 0) + 1;

      const unit = await tx.unitOfMeasure.findUnique({
        where: { key: input.unit },
        select: { id: true },
      });
      if (!unit) throw new ProductionError(`The unit "${input.unit}" is no longer set up.`);

      const record = await tx.productionRecord.create({
        data: {
          animalGroupId: context.flockId,
          productionUnitId: context.productionUnitId,
          onDate: input.onDate,
          sequence,
          ageDays: context.ageDays,
          countedBase: input.countedBase,
          countedEntered: input.counted,
          countedUomId: input.counted === null ? null : unit.id,
          disposition: input.disposition,
          dispositionNote: input.dispositionNote ?? null,
          idempotencyKey: input.idempotencyKey,
          notes: input.notes ?? null,
          warnings: warnings.length > 0 ? JSON.parse(JSON.stringify(warnings)) : undefined,
          recordedById: principal.userId,
          lines: {
            create: input.lines.map((line) => ({
              productionGradeId: line.gradeId,
              quantityBase: line.quantityBase,
              enteredQuantity: line.entered,
              enteredUomId: unit.id,
            })),
          },
        },
        select: { id: true, sequence: true },
      });

      return record;
    });

  // Two people finishing a collection in the same second is ordinary on a farm
  // with more than one house. Three attempts is plenty; the idempotency key is
  // still free after a failed insert, so a retry cannot duplicate anything.
  for (let tries = 0; ; tries++) {
    try {
      return await attempt();
    } catch (error) {
      if (tries < 2 && isSequenceCollision(error)) continue;
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// CORRECTIONS
// ---------------------------------------------------------------------------

/**
 * Correct a collection that was recorded wrongly.
 *
 * A CORRECTION IS A NEW ROW CARRYING THE NEGATIVE OF THE OLD ONE, exactly as a
 * cost allocation is reversed and a bird count is adjusted. The original stays
 * as it was reported, the reversal sits beside it, and the day's net figure
 * comes out right without anything having to know which rows are which.
 *
 * The database refuses to reverse the same record twice — `correctsId` is
 * unique — so a double submission cannot quietly subtract a collection twice.
 */
export async function correctCollection(
  principal: Principal,
  recordId: string,
  reason: string,
): Promise<{ status: 'saved'; recordId: string } | { status: 'error'; message: string }> {
  const original = await db.productionRecord.findFirst({
    where: { id: recordId, animalGroup: { site: orgFilter(principal) } },
    include: { lines: true, correctedBy: { select: { id: true } } },
  });
  if (!original) return { status: 'error', message: 'That collection no longer exists.' };

  if (original.correctsId) {
    return {
      status: 'error',
      message: 'That row is itself a correction. Correct the collection it reverses instead.',
    };
  }
  if (original.correctedBy) {
    return { status: 'error', message: 'That collection has already been corrected.' };
  }

  try {
    const reversal = await db.$transaction(async (tx) => {
      const highest = await tx.productionRecord.aggregate({
        where: { animalGroupId: original.animalGroupId, onDate: original.onDate },
        _max: { sequence: true },
      });

      return tx.productionRecord.create({
        data: {
          animalGroupId: original.animalGroupId,
          productionUnitId: original.productionUnitId,
          onDate: original.onDate,
          sequence: (highest._max.sequence ?? 0) + 1,
          ageDays: original.ageDays,
          countedBase: original.countedBase === null ? null : -original.countedBase,
          countedEntered: original.countedEntered === null ? null : -original.countedEntered,
          countedUomId: original.countedUomId,
          disposition: original.disposition,
          dispositionNote: original.dispositionNote,
          // Its own key, so the correction is protected against a retry in the
          // same way the original was.
          idempotencyKey: `correction:${original.id}`,
          notes: reason,
          correctsId: original.id,
          recordedById: principal.userId,
          lines: {
            create: original.lines.map((line) => ({
              productionGradeId: line.productionGradeId,
              quantityBase: -line.quantityBase,
              enteredQuantity: -line.enteredQuantity,
              enteredUomId: line.enteredUomId,
            })),
          },
        },
        select: { id: true },
      });
    });

    return { status: 'saved', recordId: reversal.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { status: 'error', message: 'That collection has already been corrected.' };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------

function toOutputLines(
  lines: ParsedGradeLine[],
  context: ProductionContext,
): OutputLine[] {
  const keyById = new Map(context.grades.map((g) => [g.id, g.key]));
  return lines.map((line) => ({
    gradeKey: keyById.get(line.gradeId) ?? line.gradeId,
    quantity: line.quantityBase,
  }));
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

/** A unique violation specifically on (group, date, sequence). */
function isSequenceCollision(error: unknown): boolean {
  if (!isUniqueViolation(error)) return false;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  return fields.some((f) => f.includes('sequence'));
}
