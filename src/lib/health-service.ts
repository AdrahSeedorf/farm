import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, siteFilter } from '@/lib/scope';
import type { ParsedProgrammeItem } from '@/lib/health-programme';
import { scheduleFor, needsAttention, type ScheduledEntry } from '@/lib/health-schedule';
import { ageInDays } from '@/lib/metrics';

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

// ---------------------------------------------------------------------------
// WHAT IS DUE
// ---------------------------------------------------------------------------

export interface FlockScheduleView {
  flock: {
    id: string;
    code: string;
    houseName: string | null;
    siteName: string;
    dateOfHatch: Date;
    ageDays: number;
    closed: boolean;
  };
  programme: {
    id: string;
    name: string;
    status: 'DRAFT' | 'APPROVED';
    approvedByName: string | null;
    approvedByRole: string | null;
    approvedOn: Date | null;
    sourceName: string | null;
  } | null;
  schedule: ScheduledEntry[];
}

/** One flock's schedule, with what has already been given ticked off. */
export async function flockScheduleFor(
  principal: Principal,
  flockId: string,
  asOf: Date = new Date(),
): Promise<FlockScheduleView | null> {
  const flock = await db.animalGroup.findFirst({
    where: { id: flockId, site: orgFilter(principal) },
    include: {
      site: { select: { name: true } },
      productionUnit: { select: { name: true } },
      healthProgramme: { include: { items: { orderBy: [{ ageDays: 'asc' }, { sortOrder: 'asc' }] } } },
      healthEvents: {
        select: { programmeItemId: true, occurredOn: true, name: true },
      },
    },
  });
  if (!flock) return null;

  const view: FlockScheduleView = {
    flock: {
      id: flock.id,
      code: flock.code,
      houseName: flock.productionUnit?.name ?? null,
      siteName: flock.site.name,
      dateOfHatch: flock.dateOfHatch,
      ageDays: ageInDays(flock.dateOfHatch, asOf),
      closed: flock.closedAt !== null,
    },
    programme: flock.healthProgramme
      ? {
          id: flock.healthProgramme.id,
          name: flock.healthProgramme.name,
          status: flock.healthProgramme.status,
          approvedByName: flock.healthProgramme.approvedByName,
          approvedByRole: flock.healthProgramme.approvedByRole,
          approvedOn: flock.healthProgramme.approvedOn,
          sourceName: flock.healthProgramme.sourceName,
        }
      : null,
    schedule: [],
  };

  if (!flock.healthProgramme) return view;

  view.schedule = scheduleFor(
    flock.healthProgramme.items.map((i) => ({
      id: i.id,
      ageDays: i.ageDays,
      windowDays: i.windowDays,
      name: i.name,
      sortOrder: i.sortOrder,
    })),
    flock.dateOfHatch,
    flock.healthEvents,
    asOf,
    { closed: flock.closedAt !== null },
  );

  return view;
}

export interface DueEntry {
  flockId: string;
  flockCode: string;
  houseName: string | null;
  programmeName: string;
  programmeStatus: 'DRAFT' | 'APPROVED';
  entry: ScheduledEntry;
}

/**
 * Everything due or overdue across every open flock this principal can see.
 *
 * TWO queries regardless of how many flocks there are. The scheduling itself is
 * pure arithmetic done in memory — there is no sense asking Postgres to work out
 * "hatch date plus fourteen days" when the answer depends on a window, a set of
 * completions and today's date.
 *
 * CLOSED FLOCKS ARE EXCLUDED. A flock that has been sold cannot satisfy anything
 * on its programme, and a permanent list of impossible overdue items is how
 * people learn to stop reading the list.
 */
export async function dueAcrossFlocks(
  principal: Principal,
  asOf: Date = new Date(),
  withinDays = 7,
): Promise<DueEntry[]> {
  const flocks = await db.animalGroup.findMany({
    where: {
      site: orgFilter(principal),
      ...siteFilter(principal),
      closedAt: null,
      healthProgrammeId: { not: null },
    },
    include: {
      productionUnit: { select: { name: true } },
      healthProgramme: {
        include: { items: { orderBy: [{ ageDays: 'asc' }, { sortOrder: 'asc' }] } },
      },
    },
  });
  if (flocks.length === 0) return [];

  const events = await db.healthEvent.findMany({
    where: { animalGroupId: { in: flocks.map((f) => f.id) } },
    select: { animalGroupId: true, programmeItemId: true, occurredOn: true, name: true },
  });

  const eventsByFlock = new Map<string, typeof events>();
  for (const e of events) {
    const list = eventsByFlock.get(e.animalGroupId) ?? [];
    list.push(e);
    eventsByFlock.set(e.animalGroupId, list);
  }

  const due: DueEntry[] = [];
  for (const flock of flocks) {
    const programme = flock.healthProgramme;
    if (!programme) continue;

    const schedule = scheduleFor(
      programme.items.map((i) => ({
        id: i.id,
        ageDays: i.ageDays,
        windowDays: i.windowDays,
        name: i.name,
        sortOrder: i.sortOrder,
      })),
      flock.dateOfHatch,
      eventsByFlock.get(flock.id) ?? [],
      asOf,
    );

    for (const entry of needsAttention(schedule, withinDays)) {
      due.push({
        flockId: flock.id,
        flockCode: flock.code,
        houseName: flock.productionUnit?.name ?? null,
        programmeName: programme.name,
        programmeStatus: programme.status,
        entry,
      });
    }
  }

  // Most overdue first, across every flock — the farm has one pair of hands.
  return due.sort((a, b) => b.entry.daysFromDue - a.entry.daysFromDue);
}
