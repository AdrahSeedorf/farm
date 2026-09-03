import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter } from '@/lib/scope';
import type { ParsedProgrammeItem } from '@/lib/health-programme';

/**
 * Health programme service — ADRAH Farms
 *
 * Reads and writes programmes. Holds ONE rule of its own, and it is the
 * important one:
 *
 *   CHANGING AN APPROVED PROGRAMME RETURNS IT TO DRAFT.
 *
 * Without that, someone gets a safe schedule signed off by a vet and then edits
 * it — and the edited version still carries the vet's name. The approval would
 * be attached to a document nobody had read. Every write below goes through
 * `touchProgramme`, so the rule cannot be forgotten by whoever adds the next
 * mutation.
 */

export async function listProgrammes(principal: Principal) {
  return db.healthProgramme.findMany({
    where: { ...orgFilter(principal), isActive: true },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { items: true, animalGroups: true } },
    },
  });
}

export async function programmeById(principal: Principal, programmeId: string) {
  return db.healthProgramme.findFirst({
    where: { id: programmeId, ...orgFilter(principal) },
    include: {
      items: {
        orderBy: [{ ageDays: 'asc' }, { sortOrder: 'asc' }],
        include: { item: { select: { id: true, name: true, sku: true } } },
      },
      animalGroups: { select: { id: true, code: true } },
    },
  });
}

/**
 * Mark a programme as changed.
 *
 * Any edit to the CONTENT knocks an approved programme back to draft and clears
 * the approver, because the thing they approved no longer exists. Renaming the
 * programme or correcting a typo in its description does not — those change no
 * instruction anyone acts on.
 */
export async function touchProgramme(
  programmeId: string,
  options: { contentChanged: boolean },
): Promise<void> {
  if (!options.contentChanged) {
    await db.healthProgramme.update({
      where: { id: programmeId },
      data: { updatedAt: new Date() },
    });
    return;
  }

  await db.healthProgramme.update({
    where: { id: programmeId },
    data: {
      status: 'DRAFT',
      approvedByName: null,
      approvedByRole: null,
      approvedOn: null,
    },
  });
}

export interface ImportResult {
  created: number;
  removed: number;
}

/**
 * Write an imported table into a programme.
 *
 * `replace` clears what was there first — the realistic case being a vet sending
 * a corrected schedule, where merging the two would leave the farm following a
 * mixture of both.
 *
 * One transaction: a half-imported programme with the first six entries of a new
 * schedule and the last four of an old one is worse than no import at all.
 */
export async function importProgrammeItems(
  principal: Principal,
  programmeId: string,
  rows: ParsedProgrammeItem[],
  mode: 'replace' | 'append',
): Promise<ImportResult> {
  const programme = await db.healthProgramme.findFirst({
    where: { id: programmeId, ...orgFilter(principal) },
    select: { id: true },
  });
  if (!programme) throw new Error('That programme no longer exists.');

  return db.$transaction(async (tx) => {
    let removed = 0;
    if (mode === 'replace') {
      const existing = await tx.healthProgrammeItem.findMany({
        where: { healthProgrammeId: programmeId },
        select: { id: true, events: { select: { id: true }, take: 1 } },
      });

      // Entries that something was already recorded against are KEPT. Deleting
      // them would orphan a real health event — the record of a vaccination that
      // actually happened — and no import is worth losing that.
      const deletable = existing.filter((e) => e.events.length === 0).map((e) => e.id);
      const result = await tx.healthProgrammeItem.deleteMany({
        where: { id: { in: deletable } },
      });
      removed = result.count;
    }

    const offset = await tx.healthProgrammeItem.count({
      where: { healthProgrammeId: programmeId },
    });

    await tx.healthProgrammeItem.createMany({
      data: rows.map((r, i) => ({
        healthProgrammeId: programmeId,
        ageDays: r.ageDays,
        windowDays: r.windowDays,
        name: r.name,
        eventType: r.eventType,
        route: r.route,
        dosePerBird: r.dosePerBird,
        eggWithdrawalDays: r.eggWithdrawalDays,
        meatWithdrawalDays: r.meatWithdrawalDays,
        notes: r.notes,
        sortOrder: offset + i,
      })),
    });

    await tx.healthProgramme.update({
      where: { id: programmeId },
      data: {
        status: 'DRAFT',
        approvedByName: null,
        approvedByRole: null,
        approvedOn: null,
      },
    });

    return { created: rows.length, removed };
  });
}

/** Programmes a flock could follow, for the assignment picker. */
export async function assignableProgrammes(principal: Principal) {
  return db.healthProgramme.findMany({
    where: { ...orgFilter(principal), isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, status: true, _count: { select: { items: true } } },
  });
}
