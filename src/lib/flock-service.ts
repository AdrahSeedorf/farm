import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { deltaFor, type AnimalGroupEventType } from '@/lib/ledger';
import { ageInDays } from '@/lib/metrics';
import type { Principal } from '@/lib/rbac';

/**
 * Flock service — ADRAH Farms
 *
 * The ONLY sanctioned way to write to the population ledger.
 *
 * Nothing else in the codebase calls `db.animalGroupEvent.create` directly. That
 * is the whole point: the sign of an event, the age stamp, and the coherence
 * check all live here, so they cannot be forgotten at a call site written in a
 * hurry eight months from now.
 *
 * ARCHITECTURAL RULE #1 in practice: there is no `population` column. Every
 * number this module returns is a sum over the ledger.
 */

export interface RecordEventInput {
  animalGroupId: string;
  type: AnimalGroupEventType;
  /** POSITIVE count as entered, except ADJUSTMENT which takes a signed value. */
  quantity: number;
  occurredOn: Date;
  reasonCode?: string | null;
  notes?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  toStageId?: string | null;
}

export class FlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlockError';
  }
}

/**
 * Append an event to the ledger.
 *
 * Runs in a transaction that:
 *   1. locks nothing optimistically — it re-reads the running total inside the
 *      transaction, so two people recording mortality at the same moment cannot
 *      drive the flock negative between the check and the write;
 *   2. refuses any event that would take the population below zero.
 *
 * That refusal is deliberate and loud. A population that goes negative means an
 * event was recorded against the wrong flock — almost always mortality entered
 * on the wrong house. Silently clamping to zero would hide the mistake and
 * corrupt every metric derived from it.
 */
export async function recordAnimalGroupEvent(
  principal: Principal,
  input: RecordEventInput,
): Promise<{ id: string; delta: number; population: number }> {
  return db.$transaction((tx) => recordEventWithin(tx, principal, input));
}

/**
 * The same write, INSIDE a transaction the caller already owns.
 *
 * The daily record needs this: one morning's entry creates a DailyRecord and up
 * to two ledger events, and those must all land or none of them must. A record
 * saying "6 died" alongside a ledger that never lost the birds is precisely the
 * disagreement the ledger exists to prevent.
 */
export async function recordEventWithin(
  tx: Prisma.TransactionClient,
  principal: Principal,
  input: RecordEventInput,
): Promise<{ id: string; delta: number; population: number }> {
  const delta = deltaFor(input.type, input.quantity);

  const group = await tx.animalGroup.findUnique({
    where: { id: input.animalGroupId },
    select: { id: true, dateOfHatch: true, closedAt: true, siteId: true },
  });
  if (!group) throw new FlockError('That flock no longer exists.');
  if (group.closedAt && input.type !== 'ADJUSTMENT') {
    throw new FlockError(
      'This flock is closed. Reopen it before recording new events, or record a correction.',
    );
  }

  const current = await tx.animalGroupEvent.aggregate({
    where: { animalGroupId: input.animalGroupId },
    _sum: { delta: true },
  });
  const before = current._sum.delta ?? 0;
  const after = before + delta;

  if (after < 0) {
    throw new FlockError(
      `Cannot remove ${Math.abs(delta)} birds — the flock holds ${before}. ` +
        `Check whether this belongs to a different flock or house.`,
    );
  }

  const event = await tx.animalGroupEvent.create({
    data: {
      animalGroupId: input.animalGroupId,
      type: input.type,
      delta,
      occurredOn: input.occurredOn,
      ageDays: ageInDays(group.dateOfHatch, input.occurredOn),
      reasonCode: input.reasonCode ?? null,
      notes: input.notes ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      toStageId: input.toStageId ?? null,
      recordedById: principal.userId,
    },
    select: { id: true },
  });

  // The denormalised stage cache follows the ledger, never the other way round.
  if (input.type === 'STAGE_CHANGE' && input.toStageId) {
    await tx.animalGroup.update({
      where: { id: input.animalGroupId },
      data: { currentStageId: input.toStageId },
    });
  }

  return { id: event.id, delta, population: after };
}

/** Current population of one flock, derived from the ledger. */
export async function populationOf(animalGroupId: string): Promise<number> {
  const result = await db.animalGroupEvent.aggregate({
    where: { animalGroupId },
    _sum: { delta: true },
  });
  return result._sum.delta ?? 0;
}

/**
 * Populations for many flocks in ONE query.
 *
 * The obvious implementation — loop the flocks, call `populationOf` on each — is
 * N round trips, which on a database in Europe turns a list of eight flocks into
 * a two-second page. One `groupBy` instead.
 */
export async function populationsFor(
  animalGroupIds: string[],
): Promise<Map<string, number>> {
  if (animalGroupIds.length === 0) return new Map();

  const rows = await db.animalGroupEvent.groupBy({
    by: ['animalGroupId'],
    where: { animalGroupId: { in: animalGroupIds } },
    _sum: { delta: true },
  });

  const map = new Map<string, number>();
  for (const id of animalGroupIds) map.set(id, 0);
  for (const row of rows) map.set(row.animalGroupId, row._sum.delta ?? 0);
  return map;
}

/** Total birds placed — the denominator for cumulative mortality. */
export async function placedCountOf(animalGroupId: string): Promise<number> {
  const result = await db.animalGroupEvent.aggregate({
    where: { animalGroupId, type: { in: ['PLACEMENT', 'TRANSFER_IN'] } },
    _sum: { delta: true },
  });
  return result._sum.delta ?? 0;
}

export interface FlockTotals {
  placed: number;
  population: number;
  deaths: number;
  culls: number;
  sold: number;
}

/** Every headline number for one flock, in a single round trip. */
export async function totalsFor(animalGroupId: string): Promise<FlockTotals> {
  const rows = await db.animalGroupEvent.groupBy({
    by: ['type'],
    where: { animalGroupId },
    _sum: { delta: true },
  });

  const sumOf = (type: AnimalGroupEventType) =>
    rows.find((r) => r.type === type)?._sum.delta ?? 0;

  return {
    placed: sumOf('PLACEMENT') + sumOf('TRANSFER_IN'),
    population: rows.reduce((total, r) => total + (r._sum.delta ?? 0), 0),
    deaths: Math.abs(sumOf('MORTALITY')),
    culls: Math.abs(sumOf('CULL')),
    sold: Math.abs(sumOf('SALE')),
  };
}

/**
 * Rebuild every derived value from the ledger.
 *
 * This is the promise the architecture makes: caches are disposable. If the
 * stage cache or a snapshot is ever wrong, this restores it from first
 * principles — and the fact that it CAN be run is what makes it safe to
 * denormalise at all.
 *
 * Exposed as `npm run rebuild:derived`.
 */
export async function rebuildDerivedValues(): Promise<{
  groups: number;
  stagesFixed: number;
}> {
  const groups = await db.animalGroup.findMany({
    select: { id: true, currentStageId: true },
  });

  let stagesFixed = 0;

  for (const group of groups) {
    const latestStage = await db.animalGroupEvent.findFirst({
      where: { animalGroupId: group.id, type: 'STAGE_CHANGE', toStageId: { not: null } },
      orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
      select: { toStageId: true },
    });

    const shouldBe = latestStage?.toStageId ?? null;
    if (shouldBe !== group.currentStageId) {
      await db.animalGroup.update({
        where: { id: group.id },
        data: { currentStageId: shouldBe },
      });
      stagesFixed++;
    }
  }

  return { groups: groups.length, stagesFixed };
}

/**
 * Suggest the next flock code, e.g. FLK-2027-03.
 *
 * A suggestion, not a rule — the farm can type its own. Sequential codes make a
 * flock referable in conversation ("how is FLK-2027-03 doing"), which a cuid
 * never will be.
 */
export async function suggestFlockCode(siteId: string, year: number): Promise<string> {
  const prefix = `FLK-${year}-`;
  const existing = await db.animalGroup.findMany({
    where: { siteId, code: { startsWith: prefix } },
    select: { code: true },
  });

  const highest = existing.reduce((max, { code }) => {
    const n = Number.parseInt(code.slice(prefix.length), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);

  return `${prefix}${String(highest + 1).padStart(2, '0')}`;
}
