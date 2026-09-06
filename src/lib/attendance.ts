/**
 * Attendance — ADRAH Farms
 *
 * Who turned up, when they arrived and when they left. Pure arithmetic over an
 * append-only ledger; no database.
 *
 * THIS IS NOT PAYROLL, AND MUST NOT QUIETLY BECOME IT. It records attendance so
 * a farm can answer "was anybody here when that happened?" and "is somebody
 * still on site at nine at night?". Wages, overtime rates and leave balances are
 * a different system with different consequences for getting it wrong, and the
 * specification puts them past a headcount of about six. Every figure below is
 * hours ELAPSED, never hours PAYABLE.
 *
 * THERE IS NO LOCATION IN THIS MODULE, DELIBERATELY.
 *   Clock-in is the obvious place to reach for GPS, and the brief was explicit
 *   that geofencing is to be discussed before it is built. It has not been
 *   discussed, so it does not exist — not as a nullable column, not as a
 *   "for later" field. A farm with three staff who can see each other across the
 *   yard does not need satellite confirmation that they arrived, and a system
 *   that tracks where its workers stand is a different product from one that
 *   records what they did.
 *
 * THE LEDGER IS APPEND-ONLY, exactly like population and stock. There is no
 * `isClockedIn` column. A shift is a CLOCK_IN and the CLOCK_OUT that follows it,
 * worked out on read — because a boolean and a ledger eventually disagree, and
 * the boolean is always the one that is wrong.
 */

export const ATTENDANCE_EVENTS = ['CLOCK_IN', 'CLOCK_OUT'] as const;
export type AttendanceEventType = (typeof ATTENDANCE_EVENTS)[number];

export interface AttendanceEvent {
  id: string;
  userId: string;
  userName: string;
  siteId: string;
  type: AttendanceEventType;
  occurredAt: Date;
  /** True when somebody other than the person recorded it. */
  isCorrection: boolean;
  correctionReason: string | null;
  notes: string | null;
}

/**
 * How long a shift can run before the figure stops being believable.
 *
 * SIXTEEN HOURS. A night watchman's shift is genuinely twelve, and a farmhand
 * covering for somebody who did not turn up can genuinely work fourteen. Beyond
 * sixteen the overwhelmingly likely explanation is not a very long day; it is
 * somebody who forgot to clock out, which is the single most common thing that
 * happens to attendance systems.
 *
 * IT IS A WARNING THRESHOLD, NOT A CAP. Nothing is truncated to it and no hours
 * are invented. See `shiftWarnings`.
 */
export const IMPLAUSIBLE_SHIFT_HOURS = 16;

/** How long an open shift can sit before the screen starts asking about it. */
export const STALE_OPEN_SHIFT_HOURS = 14;

export type ShiftState = 'OPEN' | 'CLOSED' | 'ORPHANED';

export interface Shift {
  /** The clock-in event's id. Null only for an orphaned clock-out. */
  id: string | null;
  userId: string;
  userName: string;
  siteId: string;
  startedAt: Date | null;
  endedAt: Date | null;
  state: ShiftState;
  /** Elapsed hours, to one decimal. Null while a shift is still open. */
  hours: number | null;
  /** Either end recorded by somebody other than the person. */
  hasCorrection: boolean;
}

const HOUR_MS = 3_600_000;

/**
 * Turn a stream of events into shifts.
 *
 * FORMULA
 *   Events are read per person, oldest first. A CLOCK_IN opens a shift. The next
 *   CLOCK_OUT closes it. Anything else is reported rather than repaired:
 *
 *     CLOCK_IN then CLOCK_IN   the first shift stays OPEN and the second opens
 *                              a new one. Neither is closed at a guessed time.
 *     CLOCK_OUT with nothing   an ORPHANED shift with no start. Somebody
 *     open                     clocked out having never clocked in, which is
 *                              usually a missed morning, and the gap is the
 *                              information.
 *
 * NOTHING HERE INVENTS A TIME. It is always possible to produce tidy shifts by
 * assuming a missing clock-out happened at the end of the working day, and that
 * assumption is how an attendance record becomes fiction. An open shift is
 * reported as open until a human closes it and says why.
 */
export function pairShifts(events: AttendanceEvent[]): Shift[] {
  const byUser = new Map<string, AttendanceEvent[]>();
  for (const event of events) {
    const list = byUser.get(event.userId) ?? [];
    list.push(event);
    byUser.set(event.userId, list);
  }

  const shifts: Shift[] = [];

  for (const [userId, list] of byUser) {
    const ordered = [...list].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    let open: AttendanceEvent | null = null;

    for (const event of ordered) {
      if (event.type === 'CLOCK_IN') {
        // A second clock-in leaves the first shift open rather than closing it
        // at the moment of the second, which would fabricate an end time.
        if (open) shifts.push(openShift(open));
        open = event;
        continue;
      }

      if (open) {
        shifts.push({
          id: open.id,
          userId,
          userName: open.userName,
          siteId: open.siteId,
          startedAt: open.occurredAt,
          endedAt: event.occurredAt,
          state: 'CLOSED',
          hours: elapsedHours(open.occurredAt, event.occurredAt),
          hasCorrection: open.isCorrection || event.isCorrection,
        });
        open = null;
      } else {
        shifts.push({
          id: null,
          userId,
          userName: event.userName,
          siteId: event.siteId,
          startedAt: null,
          endedAt: event.occurredAt,
          state: 'ORPHANED',
          hours: null,
          hasCorrection: event.isCorrection,
        });
      }
    }

    if (open) shifts.push(openShift(open));
  }

  return shifts.sort(
    (a, b) =>
      (b.startedAt ?? b.endedAt!).getTime() - (a.startedAt ?? a.endedAt!).getTime(),
  );
}

function openShift(event: AttendanceEvent): Shift {
  return {
    id: event.id,
    userId: event.userId,
    userName: event.userName,
    siteId: event.siteId,
    startedAt: event.occurredAt,
    endedAt: null,
    state: 'OPEN',
    hours: null,
    hasCorrection: event.isCorrection,
  };
}

/** Elapsed hours to one decimal. Never negative. */
export function elapsedHours(from: Date, to: Date): number {
  return Math.max(0, Math.round(((to.getTime() - from.getTime()) / HOUR_MS) * 10) / 10);
}

/** How long an open shift has been running, as of now. */
export function openFor(shift: Shift, asOf: Date = new Date()): number | null {
  return shift.state === 'OPEN' && shift.startedAt
    ? elapsedHours(shift.startedAt, asOf)
    : null;
}

/**
 * What to say about a shift. WARNINGS, never refusals.
 *
 * A fourteen-hour day is a fact about a hard week, not a data-entry error, and a
 * system that refuses to record it simply loses it.
 */
export function shiftWarnings(shift: Shift, asOf: Date = new Date()): string[] {
  const warnings: string[] = [];

  if (shift.state === 'ORPHANED') {
    warnings.push(
      'Clocked out with no matching clock-in. Usually a missed morning — worth asking ' +
        'rather than assuming.',
    );
  }

  if (shift.state === 'OPEN') {
    const hours = openFor(shift, asOf) ?? 0;
    if (hours >= STALE_OPEN_SHIFT_HOURS) {
      warnings.push(
        `Still clocked in after ${hours} hours. Either somebody is on a very long shift, ` +
          'or they went home without clocking out — the far commoner of the two.',
      );
    }
  }

  if (shift.hours !== null && shift.hours > IMPLAUSIBLE_SHIFT_HOURS) {
    warnings.push(
      `${shift.hours} hours is longer than a shift usually runs. Check the clock-out time ` +
        'before this figure goes into anything.',
    );
  }

  return warnings;
}

/** One sentence about a shift, for a list. */
export function shiftSentence(shift: Shift, asOf: Date = new Date()): string {
  if (shift.state === 'ORPHANED') return 'Clocked out with no clock-in recorded.';
  if (shift.state === 'OPEN') {
    const hours = openFor(shift, asOf);
    return `On the farm since ${clock(shift.startedAt!)} — ${hours} hours so far.`;
  }
  return `${clock(shift.startedAt!)} to ${clock(shift.endedAt!)} — ${shift.hours} hours.`;
}

/**
 * Whether this person may clock in right now, and why not.
 *
 * A SECOND CLOCK-IN IS REFUSED, uniquely in this module, because it is the one
 * case where the person is standing there and can fix it themselves: they are
 * already clocked in, and what they meant was to clock out. Everything else is
 * warned about after the fact, when the person has gone home and only a record
 * remains.
 */
export function clockInErrors(openShift: Shift | null): string[] {
  return openShift
    ? [
        `You clocked in at ${clock(openShift.startedAt!)} and have not clocked out. ` +
          'Clock out first if that shift has finished.',
      ]
    : [];
}

/**
 * Whether a clock-out can be recorded, and why not.
 *
 * `at` matters only for a CORRECTION, where somebody types the time by hand. A
 * clock-out earlier than the clock-in it would close is not a late correction,
 * it is an impossible shift — and left unchecked it produces something worse
 * than a wrong number: the clock-in stays open forever AND an orphaned clock-out
 * appears beside it, so one forgotten evening becomes two permanent anomalies.
 *
 * Found by a browser test that clocked somebody out half an hour before they
 * arrived, which is exactly the mistake a supervisor makes at the end of a long
 * day.
 */
export function clockOutErrors(openShift: Shift | null, at?: Date): string[] {
  if (!openShift) return ['You are not clocked in, so there is nothing to clock out of.'];

  if (at && openShift.startedAt && at.getTime() <= openShift.startedAt.getTime()) {
    return [
      `That is before the shift started at ${clock(openShift.startedAt)}. A clock-out has ` +
        'to come after the clock-in it closes.',
    ];
  }

  return [];
}

/**
 * Total elapsed hours across a set of shifts.
 *
 * OPEN AND ORPHANED SHIFTS CONTRIBUTE NOTHING, and the count of them is returned
 * alongside so the screen can say the total is incomplete. Counting an open
 * shift as zero and presenting the sum as a week's work would understate it
 * silently; counting it up to "now" would inflate it every time somebody forgot.
 */
export function totalHours(shifts: Shift[]): { hours: number; unfinished: number } {
  const closed = shifts.filter((s) => s.state === 'CLOSED' && s.hours !== null);
  return {
    hours: Math.round(closed.reduce((sum, s) => sum + (s.hours ?? 0), 0) * 10) / 10,
    unfinished: shifts.length - closed.length,
  };
}

/**
 * The farm-local day a shift belongs to.
 *
 * A NIGHT SHIFT BELONGS TO THE DAY IT STARTED. A watchman who comes on at seven
 * in the evening and leaves at six the next morning worked one night, not two
 * half-days, and splitting it at midnight would make every night on the farm
 * look like two short shifts.
 *
 * Ghana is UTC+0 all year with no daylight saving, which is the only reason this
 * can be a plain date calculation rather than a timezone library. The moment
 * this system runs anywhere else, that stops being true.
 */
export function shiftDayOf(occurredAt: Date): Date {
  return new Date(
    Date.UTC(occurredAt.getUTCFullYear(), occurredAt.getUTCMonth(), occurredAt.getUTCDate()),
  );
}

/** 06:42 — how a time is read out. */
export function clock(at: Date): string {
  return `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`;
}
