import { describe, it, expect } from 'vitest';
import {
  ATTENDANCE_EVENTS,
  IMPLAUSIBLE_SHIFT_HOURS,
  STALE_OPEN_SHIFT_HOURS,
  pairShifts,
  elapsedHours,
  openFor,
  shiftWarnings,
  shiftSentence,
  clockInErrors,
  clockOutErrors,
  totalHours,
  shiftDayOf,
  clock,
  type AttendanceEvent,
} from '../attendance';

const at = (iso: string) => new Date(`${iso}Z`);

let seq = 0;
const event = (
  type: 'CLOCK_IN' | 'CLOCK_OUT',
  iso: string,
  over: Partial<AttendanceEvent> = {},
): AttendanceEvent => ({
  id: `e${++seq}`,
  userId: 'kwame',
  userName: 'Kwame',
  siteId: 'site-a',
  type,
  occurredAt: at(iso),
  isCorrection: false,
  correctionReason: null,
  notes: null,
  ...over,
});

describe('an ordinary day', () => {
  it('pairs a clock-in with the clock-out that follows it', () => {
    const shifts = pairShifts([
      event('CLOCK_IN', '2026-09-06T05:30:00'),
      event('CLOCK_OUT', '2026-09-06T14:00:00'),
    ]);
    expect(shifts).toHaveLength(1);
    expect(shifts[0].state).toBe('CLOSED');
    expect(shifts[0].hours).toBe(8.5);
  });

  it('keeps two people’s days apart', () => {
    const shifts = pairShifts([
      event('CLOCK_IN', '2026-09-06T05:30:00'),
      event('CLOCK_IN', '2026-09-06T06:00:00', { userId: 'abena', userName: 'Abena' }),
      event('CLOCK_OUT', '2026-09-06T14:00:00'),
      event('CLOCK_OUT', '2026-09-06T15:00:00', { userId: 'abena', userName: 'Abena' }),
    ]);
    expect(shifts).toHaveLength(2);
    expect(shifts.every((s) => s.state === 'CLOSED')).toBe(true);
    expect(shifts.find((s) => s.userId === 'abena')!.hours).toBe(9);
  });

  it('reads the day back as times, not timestamps', () => {
    const shifts = pairShifts([
      event('CLOCK_IN', '2026-09-06T05:30:00'),
      event('CLOCK_OUT', '2026-09-06T14:00:00'),
    ]);
    expect(shiftSentence(shifts[0])).toBe('05:30 to 14:00 — 8.5 hours.');
  });

  it('has exactly two kinds of event, and no third for “on a break”', () => {
    // Breaks are a rota-engine idea. With three staff who eat when the work
    // allows, a break button is a field that is always blank.
    expect(ATTENDANCE_EVENTS).toEqual(['CLOCK_IN', 'CLOCK_OUT']);
  });
});

describe('A NIGHT SHIFT BELONGS TO THE NIGHT IT STARTED', () => {
  it('crosses midnight as one shift, not two half-days', () => {
    // The watchman comes on at seven in the evening and leaves at six. Splitting
    // that at midnight would make every night on this farm look like two short
    // shifts and would halve the figure anybody looked at.
    const shifts = pairShifts([
      event('CLOCK_IN', '2026-09-06T19:00:00'),
      event('CLOCK_OUT', '2026-09-07T06:00:00'),
    ]);
    expect(shifts).toHaveLength(1);
    expect(shifts[0].hours).toBe(11);
  });

  it('and the day it counts against is the day it began', () => {
    expect(shiftDayOf(at('2026-09-06T19:00:00')).toISOString().slice(0, 10)).toBe('2026-09-06');
    expect(shiftDayOf(at('2026-09-06T23:59:00')).toISOString().slice(0, 10)).toBe('2026-09-06');
    expect(shiftDayOf(at('2026-09-07T00:01:00')).toISOString().slice(0, 10)).toBe('2026-09-07');
  });
});

describe('THE THING THAT ACTUALLY HAPPENS: nobody clocks out', () => {
  it('leaves the shift OPEN rather than closing it at a guessed time', () => {
    // It is always possible to produce tidy shifts by assuming everybody left at
    // six. That assumption is how an attendance record becomes fiction.
    const shifts = pairShifts([event('CLOCK_IN', '2026-09-06T05:30:00')]);
    expect(shifts[0].state).toBe('OPEN');
    expect(shifts[0].endedAt).toBeNull();
    expect(shifts[0].hours).toBeNull();
  });

  it('says how long it has been open, as of now', () => {
    const shifts = pairShifts([event('CLOCK_IN', '2026-09-06T05:30:00')]);
    expect(openFor(shifts[0], at('2026-09-06T11:30:00'))).toBe(6);
    expect(shiftSentence(shifts[0], at('2026-09-06T11:30:00'))).toMatch(
      /On the farm since 05:30 — 6 hours so far/,
    );
  });

  it('AND STARTS ASKING ABOUT IT after a plausible shift has passed', () => {
    const shifts = pairShifts([event('CLOCK_IN', '2026-09-06T05:30:00')]);
    expect(shiftWarnings(shifts[0], at('2026-09-06T12:00:00'))).toEqual([]);

    const warnings = shiftWarnings(shifts[0], at('2026-09-06T21:00:00'));
    expect(warnings[0]).toMatch(/Still clocked in after 15\.5 hours/);
    expect(warnings[0]).toMatch(/far commoner of the two/);
    expect(STALE_OPEN_SHIFT_HOURS).toBeLessThan(IMPLAUSIBLE_SHIFT_HOURS);
  });

  it('a second clock-in opens a second shift and leaves the first open', () => {
    // Closing the first at the moment of the second would fabricate an end time
    // for a shift nobody ended.
    const shifts = pairShifts([
      event('CLOCK_IN', '2026-09-06T05:30:00'),
      event('CLOCK_IN', '2026-09-07T05:30:00'),
    ]);
    expect(shifts).toHaveLength(2);
    expect(shifts.every((s) => s.state === 'OPEN')).toBe(true);
    expect(shifts.every((s) => s.hours === null)).toBe(true);
  });

  it('AND A CLOCK-OUT WITH NO CLOCK-IN IS REPORTED, not swallowed', () => {
    // Somebody clocked out having never clocked in — usually a missed morning,
    // and the gap is the information.
    const shifts = pairShifts([event('CLOCK_OUT', '2026-09-06T14:00:00')]);
    expect(shifts[0].state).toBe('ORPHANED');
    expect(shifts[0].startedAt).toBeNull();
    expect(shiftWarnings(shifts[0])[0]).toMatch(/no matching clock-in/i);
  });
});

describe('a shift too long to believe', () => {
  it('IS RECORDED ANYWAY, and flagged', () => {
    // A fourteen-hour day is a fact about a hard week. A system that refuses to
    // record it simply loses it.
    const shifts = pairShifts([
      event('CLOCK_IN', '2026-09-06T05:00:00'),
      event('CLOCK_OUT', '2026-09-07T04:00:00'),
    ]);
    expect(shifts[0].state).toBe('CLOSED');
    expect(shifts[0].hours).toBe(23);
    expect(shiftWarnings(shifts[0])[0]).toMatch(/longer than a shift usually runs/i);
  });

  it('but a genuinely long night is not flagged', () => {
    const shifts = pairShifts([
      event('CLOCK_IN', '2026-09-06T18:00:00'),
      event('CLOCK_OUT', '2026-09-07T06:00:00'),
    ]);
    expect(shifts[0].hours).toBe(12);
    expect(shiftWarnings(shifts[0])).toEqual([]);
  });
});

describe('clocking in and out', () => {
  it('REFUSES A SECOND CLOCK-IN, because the person is standing there', () => {
    // The one refusal in this module. Everything else is warned about after the
    // fact, when only a record remains; here the person can fix it themselves.
    const open = pairShifts([event('CLOCK_IN', '2026-09-06T05:30:00')])[0];
    expect(clockInErrors(open)[0]).toMatch(/clocked in at 05:30/);
    expect(clockInErrors(open)[0]).toMatch(/Clock out first/);
    expect(clockInErrors(null)).toEqual([]);
  });

  it('and refuses a clock-out from somebody who is not clocked in', () => {
    expect(clockOutErrors(null)[0]).toMatch(/nothing to clock out of/i);
    expect(
      clockOutErrors(pairShifts([event('CLOCK_IN', '2026-09-06T05:30:00')])[0]),
    ).toEqual([]);
  });

  it('REFUSES A CLOCK-OUT BEFORE THE CLOCK-IN IT WOULD CLOSE', () => {
    // Not a late correction — an impossible shift. Left unchecked it is worse
    // than a wrong number: the clock-in stays open forever AND an orphaned
    // clock-out appears beside it, so one forgotten evening becomes two
    // permanent anomalies. A browser test found this by clocking somebody out
    // half an hour before they arrived, which is the mistake a supervisor
    // actually makes at the end of a long day.
    const open = pairShifts([event('CLOCK_IN', '2026-09-06T05:30:00')])[0];
    expect(clockOutErrors(open, at('2026-09-06T05:00:00'))[0]).toMatch(
      /before the shift started at 05:30/,
    );
    expect(clockOutErrors(open, at('2026-09-06T05:30:00'))).toHaveLength(1);
    expect(clockOutErrors(open, at('2026-09-06T14:00:00'))).toEqual([]);
  });
});

describe('adding a week up', () => {
  const week = () =>
    pairShifts([
      event('CLOCK_IN', '2026-09-01T06:00:00'),
      event('CLOCK_OUT', '2026-09-01T14:00:00'),
      event('CLOCK_IN', '2026-09-02T06:00:00'),
      event('CLOCK_OUT', '2026-09-02T14:30:00'),
      event('CLOCK_IN', '2026-09-03T06:00:00'),
    ]);

  it('counts only the shifts that finished', () => {
    expect(totalHours(week()).hours).toBe(16.5);
  });

  it('AND SAYS HOW MANY DID NOT, so the total is not read as complete', () => {
    // Counting an open shift as zero would understate the week silently;
    // counting it up to "now" would inflate it every time somebody forgot.
    expect(totalHours(week()).unfinished).toBe(1);
  });

  it('an empty week is zero, not nothing', () => {
    expect(totalHours([])).toEqual({ hours: 0, unfinished: 0 });
  });
});

describe('the small arithmetic', () => {
  it('never reports negative hours', () => {
    expect(elapsedHours(at('2026-09-06T14:00:00'), at('2026-09-06T05:00:00'))).toBe(0);
  });

  it('rounds to one decimal, which is as precise as a farm clock is', () => {
    expect(elapsedHours(at('2026-09-06T05:00:00'), at('2026-09-06T13:22:00'))).toBe(8.4);
  });

  it('reads a time back with a leading zero', () => {
    expect(clock(at('2026-09-06T05:07:00'))).toBe('05:07');
    expect(clock(at('2026-09-06T23:59:00'))).toBe('23:59');
  });
});

describe('what this module deliberately does not have', () => {
  it('NO LOCATION, not even a nullable one', () => {
    // Clock-in is the obvious place to reach for GPS, and the brief was explicit
    // that geofencing is discussed before it is built. A "for later" nullable
    // column is how that discussion gets skipped.
    const shifts = pairShifts([event('CLOCK_IN', '2026-09-06T05:30:00')]);
    const keys = Object.keys(shifts[0]).join(' ').toLowerCase();
    expect(keys).not.toMatch(/lat|lon|gps|location|coordinate|geo/);
  });

  it('and no pay, rate or overtime anywhere in a shift', () => {
    // Hours ELAPSED, never hours PAYABLE. Wages are a different system with
    // different consequences for being wrong.
    const shifts = pairShifts([
      event('CLOCK_IN', '2026-09-06T05:30:00'),
      event('CLOCK_OUT', '2026-09-06T14:00:00'),
    ]);
    const keys = Object.keys(shifts[0]).join(' ').toLowerCase();
    expect(keys).not.toMatch(/pay|wage|rate|overtime|salary/);
  });
});
