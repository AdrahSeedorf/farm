import { describe, it, expect } from 'vitest';
import {
  scheduleFor,
  needsAttention,
  scheduleSentence,
  withdrawalClearsOn,
  activeWithdrawals,
  clearFor,
  requiredQuantity,
  daysBetween,
  addDays,
  type ProgrammeItem,
  type CompletedEvent,
} from '../health-schedule';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const hatch = d('2026-08-01');

/**
 * NOTE ON THE FIGURES IN THESE TESTS.
 *
 * The ages and withdrawal periods below are ARBITRARY test fixtures, chosen to
 * make the arithmetic easy to check by eye. They are not a schedule, they are
 * not advice, and nothing in the shipped code contains a schedule of any kind.
 */
const item = (over: Partial<ProgrammeItem> = {}): ProgrammeItem => ({
  id: 'i1',
  ageDays: 10,
  windowDays: 2,
  name: 'Test entry',
  sortOrder: 0,
  ...over,
});

describe('turning a programme into dates', () => {
  it('counts from HATCH, not from arrival', () => {
    const [entry] = scheduleFor([item({ ageDays: 14 })], hatch, [], d('2026-08-01'));
    expect(entry.dueOn).toEqual(d('2026-08-15'));
  });

  it('opens a window either side of the due date', () => {
    const [entry] = scheduleFor([item({ ageDays: 14, windowDays: 3 })], hatch, [], hatch);
    expect(entry.windowEndsOn).toEqual(d('2026-08-18'));
  });

  it('sorts by age, then by the order the farm put them in', () => {
    const s = scheduleFor(
      [
        item({ id: 'b', ageDays: 14, sortOrder: 1, name: 'Second on the day' }),
        item({ id: 'a', ageDays: 14, sortOrder: 0, name: 'First on the day' }),
        item({ id: 'c', ageDays: 7, name: 'Earlier' }),
      ],
      hatch,
      [],
      hatch,
    );
    expect(s.map((e) => e.item.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('what is due, late and done', () => {
  const items = [item({ id: 'i1', ageDays: 10, windowDays: 2 })];

  it('is upcoming before the day', () => {
    const [e] = scheduleFor(items, hatch, [], d('2026-08-05'));
    expect(e.status).toBe('UPCOMING');
    expect(e.daysFromDue).toBe(-6);
  });

  it('is due on the day', () => {
    expect(scheduleFor(items, hatch, [], d('2026-08-11'))[0].status).toBe('DUE');
  });

  it('is still due inside the window, not late', () => {
    expect(scheduleFor(items, hatch, [], d('2026-08-13'))[0].status).toBe('DUE');
  });

  it('is overdue the day after the window closes', () => {
    expect(scheduleFor(items, hatch, [], d('2026-08-14'))[0].status).toBe('OVERDUE');
  });

  it('is done once an event points at it, however late', () => {
    const events: CompletedEvent[] = [
      { programmeItemId: 'i1', occurredOn: d('2026-08-20'), name: 'Test entry' },
    ];
    const [e] = scheduleFor(items, hatch, events, d('2026-08-25'));
    expect(e.status).toBe('DONE');
    expect(e.doneOn).toEqual(d('2026-08-20'));
  });

  it('keeps the EARLIEST completion when something was given twice', () => {
    const events: CompletedEvent[] = [
      { programmeItemId: 'i1', occurredOn: d('2026-08-14'), name: 'x' },
      { programmeItemId: 'i1', occurredOn: d('2026-08-11'), name: 'x' },
    ];
    expect(scheduleFor(items, hatch, events, d('2026-08-25'))[0].doneOn).toEqual(d('2026-08-11'));
  });

  it('ignores unplanned events — they fulfil nothing on the programme', () => {
    // An outbreak treatment is real and recorded, but it does not tick off a
    // scheduled vaccination that was never given.
    const events: CompletedEvent[] = [
      { programmeItemId: null, occurredOn: d('2026-08-11'), name: 'Outbreak treatment' },
    ];
    expect(scheduleFor(items, hatch, events, d('2026-08-20'))[0].status).toBe('OVERDUE');
  });

  it('stops nagging about a closed flock', () => {
    // A closed flock cannot satisfy anything; a list of permanent overdue items
    // is noise that teaches people to ignore the list.
    const [e] = scheduleFor(items, hatch, [], d('2026-09-30'), { closed: true });
    expect(e.status).toBe('NOT_APPLICABLE');
  });

  it('but still shows what a closed flock actually received', () => {
    const events: CompletedEvent[] = [
      { programmeItemId: 'i1', occurredOn: d('2026-08-11'), name: 'x' },
    ];
    expect(scheduleFor(items, hatch, events, d('2026-09-30'), { closed: true })[0].status).toBe(
      'DONE',
    );
  });
});

describe('what needs attention', () => {
  const items = [
    item({ id: 'past', ageDays: 5, windowDays: 1 }),
    item({ id: 'today', ageDays: 12 }),
    item({ id: 'soon', ageDays: 16 }),
    item({ id: 'far', ageDays: 60 }),
  ];

  it('shows overdue first, then due, then what is close', () => {
    const s = scheduleFor(items, hatch, [], d('2026-08-13'));
    expect(needsAttention(s).map((e) => e.item.id)).toEqual(['past', 'today', 'soon']);
  });

  it('leaves the distant future alone', () => {
    const s = scheduleFor(items, hatch, [], d('2026-08-13'));
    expect(needsAttention(s).map((e) => e.item.id)).not.toContain('far');
  });

  it('drops anything already done', () => {
    const s = scheduleFor(items, hatch, [{ programmeItemId: 'past', occurredOn: d('2026-08-06'), name: 'x' }], d('2026-08-13'));
    expect(needsAttention(s).map((e) => e.item.id)).not.toContain('past');
  });
});

describe('the sentence people read', () => {
  it('says when something was given', () => {
    const s = scheduleFor([item()], hatch, [{ programmeItemId: 'i1', occurredOn: d('2026-08-11'), name: 'x' }], d('2026-08-20'));
    expect(scheduleSentence(s[0])).toBe('Given 2026-08-11.');
  });

  it('says how late something is', () => {
    const s = scheduleFor([item()], hatch, [], d('2026-08-20'));
    expect(scheduleSentence(s[0])).toBe('Overdue — was due 2026-08-11, 9 days ago.');
  });

  it('says when it is due today', () => {
    const s = scheduleFor([item()], hatch, [], d('2026-08-11'));
    expect(scheduleSentence(s[0])).toMatch(/Due now \(day 10, 2026-08-11\)/);
  });

  it('counts down to a future one, in the singular where it should', () => {
    const s = scheduleFor([item()], hatch, [], d('2026-08-10'));
    expect(scheduleSentence(s[0])).toBe('Due in 1 day, on 2026-08-11.');
  });
});

describe('withdrawal periods', () => {
  it('clears on the day AFTER the stated period, as the label means it', () => {
    // Treated on the 1st with 7 days: the 1st to the 7th are restricted, the
    // 8th is clear.
    expect(withdrawalClearsOn(d('2026-08-01'), 7)).toEqual(d('2026-08-08'));
  });

  it('returns null when NO period was recorded — which is not zero', () => {
    // "This product has no withdrawal" is a claim only a label can make.
    expect(withdrawalClearsOn(d('2026-08-01'), null)).toBeNull();
  });

  it('treats a recorded zero as a real answer', () => {
    expect(withdrawalClearsOn(d('2026-08-01'), 0)).toEqual(d('2026-08-01'));
  });

  it('lists what is still in force, longest first', () => {
    const active = activeWithdrawals(
      [
        { name: 'Antibiotic', occurredOn: d('2026-08-20'), eggWithdrawalDays: 7, meatWithdrawalDays: 10 },
        { name: 'Vitamin', occurredOn: d('2026-08-20'), eggWithdrawalDays: 0, meatWithdrawalDays: null },
      ],
      d('2026-08-24'),
    );
    expect(active.map((w) => `${w.name}:${w.kind}`)).toEqual(['Antibiotic:MEAT', 'Antibiotic:EGGS']);
    expect(active[1].clearsOn).toEqual(d('2026-08-27'));
    expect(active[1].daysRemaining).toBe(3);
    expect(active[1].lastRestrictedDay).toEqual(d('2026-08-26'));
  });

  it('drops a withdrawal that has already cleared', () => {
    const active = activeWithdrawals(
      [{ name: 'Antibiotic', occurredOn: d('2026-08-01'), eggWithdrawalDays: 7, meatWithdrawalDays: null }],
      d('2026-08-08'),
    );
    expect(active).toEqual([]);
  });

  it('NEVER lets a later treatment shorten an earlier one', () => {
    // A two-day product given after a ten-day one must not clear the flock.
    const active = activeWithdrawals(
      [
        { name: 'Long', occurredOn: d('2026-08-20'), eggWithdrawalDays: 10, meatWithdrawalDays: null },
        { name: 'Short', occurredOn: d('2026-08-22'), eggWithdrawalDays: 2, meatWithdrawalDays: null },
      ],
      d('2026-08-25'),
    );
    expect(clearFor(active, 'EGGS')).toEqual(d('2026-08-30'));
  });

  it('says nothing is restricted when nothing is', () => {
    expect(clearFor([], 'EGGS')).toBeNull();
  });

  it('keeps eggs and meat apart', () => {
    const active = activeWithdrawals(
      [{ name: 'X', occurredOn: d('2026-08-20'), eggWithdrawalDays: null, meatWithdrawalDays: 14 }],
      d('2026-08-25'),
    );
    expect(clearFor(active, 'EGGS')).toBeNull();
    expect(clearFor(active, 'MEAT')).toEqual(d('2026-09-03'));
  });
});

describe('how much a treatment needs', () => {
  it('multiplies birds by the dose the farm entered', () => {
    expect(requiredQuantity(940, 1)).toBe(940);
    expect(requiredQuantity(1000, 0.5)).toBe(500);
  });

  it('does NOT round up to a whole vial', () => {
    // 940 doses out of a 1,000-dose vial leaves 60 discarded. That is waste, and
    // it belongs in the waste figures, not buried in the flock's treatment cost
    // as though the birds had received it.
    expect(requiredQuantity(940, 1)).toBe(940);
  });

  it('says nothing when no dose was recorded', () => {
    expect(requiredQuantity(1000, null)).toBeNull();
    expect(requiredQuantity(1000, 0)).toBeNull();
  });

  it('says nothing for a flock with no birds', () => {
    expect(requiredQuantity(0, 1)).toBeNull();
  });
});

describe('date helpers', () => {
  it('counts whole days regardless of the time of day', () => {
    expect(daysBetween(new Date('2026-08-01T23:00:00Z'), new Date('2026-08-03T01:00:00Z'))).toBe(2);
  });

  it('adds days without drifting', () => {
    expect(addDays(d('2026-08-30'), 5)).toEqual(d('2026-09-04'));
  });
});

describe('a whole flock’s week, end to end', () => {
  /**
   * The realistic shape: a programme with entries scattered through rearing, a
   * flock part-way through it, and a handful of things already given. What the
   * farm needs from this is a short list — not forty rows.
   */
  const programme: ProgrammeItem[] = [
    { id: 'a', ageDays: 7, windowDays: 2, name: 'Entry A', sortOrder: 0 },
    { id: 'b', ageDays: 14, windowDays: 2, name: 'Entry B', sortOrder: 0 },
    { id: 'c', ageDays: 21, windowDays: 3, name: 'Entry C', sortOrder: 0 },
    { id: 'd', ageDays: 35, windowDays: 2, name: 'Entry D', sortOrder: 0 },
    { id: 'e', ageDays: 112, windowDays: 7, name: 'Entry E', sortOrder: 0 },
  ];
  const given: CompletedEvent[] = [
    { programmeItemId: 'a', occurredOn: d('2026-08-08'), name: 'Entry A' },
    { programmeItemId: 'b', occurredOn: d('2026-08-15'), name: 'Entry B' },
  ];

  // Hatched 1 August; today is the 26th, so the flock is 26 days old.
  const schedule = scheduleFor(programme, hatch, given, d('2026-08-26'));

  it('ticks off what was given', () => {
    expect(schedule.filter((e) => e.status === 'DONE').map((e) => e.item.id)).toEqual(['a', 'b']);
  });

  it('marks the one that slipped past its window', () => {
    // Due day 21 (22 August), window 3 -> still on time to the 25th, late on
    // the 26th. Off by one here is the difference between a warning that fires
    // a day early every time and one people trust.
    expect(schedule.find((e) => e.item.id === 'c')!.status).toBe('OVERDUE');
  });

  it('leaves the rest upcoming', () => {
    expect(schedule.find((e) => e.item.id === 'd')!.status).toBe('UPCOMING');
    expect(schedule.find((e) => e.item.id === 'e')!.status).toBe('UPCOMING');
  });

  it('SHORTENS FORTY ROWS TO THE TWO THAT MATTER', () => {
    // Entry D is due in ten days, past the week-long horizon, so it stays off
    // the list. A list that includes everything is a list nobody reads.
    const attention = needsAttention(schedule, 7);
    expect(attention.map((e) => e.item.id)).toEqual(['c']);
  });

  it('widens when asked, for a fortnight’s planning', () => {
    expect(needsAttention(schedule, 14).map((e) => e.item.id)).toEqual(['c', 'd']);
  });

  it('shows nothing at all once the flock is closed', () => {
    const closed = scheduleFor(programme, hatch, given, d('2026-08-26'), { closed: true });
    expect(needsAttention(closed)).toEqual([]);
  });
});
