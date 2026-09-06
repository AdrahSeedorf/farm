import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, siteFilter, canAccessSite } from '@/lib/scope';
import {
  pairShifts,
  shiftDayOf,
  clockInErrors,
  clockOutErrors,
  type AttendanceEvent,
  type AttendanceEventType,
  type Shift,
} from '@/lib/attendance';

/**
 * Attendance service — ADRAH Farms
 *
 * THE ONLY PLACE AN AttendanceEvent IS WRITTEN.
 *
 * Everything a screen shows is derived from the ledger by `pairShifts`. Nothing
 * here stores a shift, a total, or a "currently on site" flag.
 *
 * WHOSE ATTENDANCE VS WHO RECORDED IT is the distinction this file exists to
 * keep straight. A farmhand clocking themselves in is one fact; a supervisor
 * closing a shift that farmhand forgot to close is a different one, and the
 * second must never be able to masquerade as the first.
 */

export class AttendanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttendanceError';
  }
}

const include = {
  user: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, name: true } },
} as const;

type DbEvent = {
  id: string;
  userId: string;
  siteId: string;
  type: AttendanceEventType;
  occurredAt: Date;
  correctionReason: string | null;
  notes: string | null;
  recordedById: string;
  user: { id: string; name: string };
  recordedBy: { id: string; name: string };
};

function toEvent(row: DbEvent): AttendanceEvent {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.user.name,
    siteId: row.siteId,
    type: row.type,
    occurredAt: row.occurredAt,
    // Recorded by somebody else — see the note on the model.
    isCorrection: row.recordedById !== row.userId,
    correctionReason: row.correctionReason,
    notes: row.notes,
  };
}

/**
 * Every shift touching a window, for the people this principal may see.
 *
 * READS A WIDER WINDOW THAN IT REPORTS. A shift that began the night before the
 * window opened has its clock-in outside it, and querying only the window would
 * hand `pairShifts` a clock-out with nothing to pair against — reporting every
 * night shift on the farm as orphaned.
 */
export async function shiftsBetween(
  principal: Principal,
  from: Date,
  to: Date,
  options: { userId?: string } = {},
): Promise<Shift[]> {
  const lookBack = new Date(from.getTime() - 2 * 86_400_000);

  const rows = await db.attendanceEvent.findMany({
    where: {
      ...orgFilter(principal),
      ...siteFilter(principal),
      ...(options.userId ? { userId: options.userId } : {}),
      occurredAt: { gte: lookBack, lte: to },
    },
    orderBy: { occurredAt: 'asc' },
    include,
  });

  const shifts = pairShifts(rows.map((r) => toEvent(r as unknown as DbEvent)));

  // Now discard the ones that were only read to make the pairing correct.
  return shifts.filter((s) => {
    const anchor = s.startedAt ?? s.endedAt!;
    return anchor >= from && anchor <= to;
  });
}

/** The shift this person is currently in, if any. */
export async function openShiftFor(
  principal: Principal,
  userId: string,
): Promise<Shift | null> {
  // Two weeks is long enough to catch a shift somebody forgot to close a while
  // ago, and short enough not to scan a year of history on every page load.
  const rows = await db.attendanceEvent.findMany({
    where: {
      ...orgFilter(principal),
      userId,
      occurredAt: { gte: new Date(Date.now() - 14 * 86_400_000) },
    },
    orderBy: { occurredAt: 'asc' },
    include,
  });

  const shifts = pairShifts(rows.map((r) => toEvent(r as unknown as DbEvent)));
  return shifts.find((s) => s.state === 'OPEN') ?? null;
}

export interface ClockInput {
  /** Whose attendance. Defaults to the person acting. */
  userId?: string;
  siteId: string;
  /** The instant. Defaults to now; a correction supplies its own. */
  occurredAt?: Date;
  notes?: string | null;
  /** Required when recording on somebody else's behalf. */
  correctionReason?: string | null;
}

async function record(
  principal: Principal,
  type: AttendanceEventType,
  input: ClockInput,
): Promise<{ id: string; userName: string }> {
  const userId = input.userId ?? principal.userId;
  const onBehalf = userId !== principal.userId;

  if (!canAccessSite(principal, input.siteId)) {
    throw new AttendanceError('That farm is not one you have access to.');
  }

  const site = await db.site.findFirst({
    where: { id: input.siteId, ...orgFilter(principal) },
    select: { id: true },
  });
  if (!site) throw new AttendanceError('That farm no longer exists.');

  const subject = await db.user.findFirst({
    where: { id: userId, ...orgFilter(principal), isActive: true },
    select: { id: true, name: true },
  });
  if (!subject) throw new AttendanceError('That account is not active.');

  // A REASON IS REQUIRED to record on somebody else's behalf. In three months
  // "why does the record say I left at six when I left at four" is a question
  // somebody has to be able to answer, and only this field answers it.
  if (onBehalf && !input.correctionReason?.trim()) {
    throw new AttendanceError(
      `Say why you are recording this for ${subject.name}. An entry made on somebody's ` +
        'behalf with no explanation is one they cannot dispute later.',
    );
  }

  const occurredAt = input.occurredAt ?? new Date();

  // NO FUTURE TOLERANCE AT ALL, not even a minute's worth for clock skew.
  //
  // A self clock-in takes the server's own clock, so it is never in the future;
  // the tolerance could only ever apply to a hand-typed correction, where it
  // does real harm. Every "what happened up to now" query is bounded by now, so
  // an event a minute ahead is written successfully and then invisible to the
  // screen that was supposed to show it — the shift stays open, the correction
  // appears to have done nothing, and somebody records it again.
  if (occurredAt.getTime() > Date.now()) {
    throw new AttendanceError('That time has not happened yet.');
  }

  const open = await openShiftFor(principal, userId);
  const problems =
    type === 'CLOCK_IN' ? clockInErrors(open) : clockOutErrors(open, occurredAt);
  if (problems.length > 0) throw new AttendanceError(problems[0]);

  const created = await db.attendanceEvent.create({
    data: {
      organisationId: principal.organisationId,
      userId,
      siteId: input.siteId,
      type,
      occurredAt,
      // A clock-out belongs to the day its SHIFT started, not to the calendar
      // day it happened on. Without this, every night shift is split in two.
      shiftDay:
        type === 'CLOCK_OUT' && open?.startedAt
          ? shiftDayOf(open.startedAt)
          : shiftDayOf(occurredAt),
      notes: input.notes ?? null,
      recordedById: principal.userId,
      correctionReason: onBehalf ? input.correctionReason!.trim() : null,
    },
    select: { id: true },
  });

  return { id: created.id, userName: subject.name };
}

export function clockIn(principal: Principal, input: ClockInput) {
  return record(principal, 'CLOCK_IN', input);
}

export function clockOut(principal: Principal, input: ClockInput) {
  return record(principal, 'CLOCK_OUT', input);
}

/** Sites this person may clock in at. */
export async function clockSites(principal: Principal) {
  return db.site.findMany({
    where: {
      ...orgFilter(principal),
      isActive: true,
      ...(principal.siteScope.length > 0 ? { id: { in: principal.siteScope } } : {}),
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}

/** Everyone whose attendance this person may record — for the correction form. */
export async function correctableStaff(principal: Principal) {
  return db.user.findMany({
    where: { ...orgFilter(principal), isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}
