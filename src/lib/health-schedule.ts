/**
 * Health scheduling — ADRAH Farms
 *
 * THE SYSTEM HOLDS NO MEDICAL OPINION. Read that before adding anything here.
 *
 * There is no built-in vaccination schedule in this file, no default withdrawal
 * period, and no suggested dose. Not one number below is clinical. Every
 * programme is supplied by the farm's veterinarian, entered as data, and carries
 * the name of the person who stood behind it.
 *
 * A shipped default would be trusted. A farmhand would give a vaccine on day 14
 * because the screen said day 14, and nobody could later say which vet chose
 * that day, for which breed, under which local disease pressure. Ghana's
 * Newcastle challenge is not Europe's, and a wrong schedule empties a house.
 *
 * WHAT THIS MODULE ACTUALLY DOES is arithmetic on dates:
 *   - a programme keyed to AGE plus a date of hatch gives a set of dates;
 *   - a set of dates plus today gives what is due, late, or done;
 *   - a treatment plus a stated withdrawal period gives the day sales may resume.
 *
 * That is bookkeeping, and bookkeeping is what software should be trusted with.
 */

export type ScheduleStatus = 'DONE' | 'DUE' | 'OVERDUE' | 'UPCOMING' | 'NOT_APPLICABLE';

export interface ProgrammeItem {
  id: string;
  ageDays: number;
  windowDays: number;
  name: string;
  sortOrder: number;
}

export interface CompletedEvent {
  programmeItemId: string | null;
  occurredOn: Date;
  name: string;
}

export interface ScheduledEntry {
  item: ProgrammeItem;
  dueOn: Date;
  /** Last day this still counts as on time. */
  windowEndsOn: Date;
  status: ScheduleStatus;
  /** Negative until the due date, positive once past it. */
  daysFromDue: number;
  doneOn: Date | null;
}

const DAY_MS = 86_400_000;

export function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function addDays(d: Date, days: number): Date {
  return new Date(startOfDay(d) + days * DAY_MS);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

/**
 * Turn a programme into dates for one flock.
 *
 * The due date is HATCH + ageDays, never arrival + ageDays. A flock delivered
 * three days late is still the age it hatched, and every published poultry
 * schedule is written against age from hatch. Using arrival would quietly shift
 * a whole programme by however long the lorry took.
 *
 * A flock that has been closed gets NOT_APPLICABLE for anything not already
 * done, rather than a list of overdue items it can never satisfy.
 */
export function scheduleFor(
  items: ProgrammeItem[],
  dateOfHatch: Date,
  events: CompletedEvent[],
  asOf: Date,
  options: { closed?: boolean } = {},
): ScheduledEntry[] {
  const doneByItem = new Map<string, Date>();
  for (const e of events) {
    if (!e.programmeItemId) continue;
    const existing = doneByItem.get(e.programmeItemId);
    // Keep the EARLIEST completion: giving a vaccine twice does not make the
    // second dose the one that counts.
    if (!existing || e.occurredOn.getTime() < existing.getTime()) {
      doneByItem.set(e.programmeItemId, e.occurredOn);
    }
  }

  return [...items]
    .sort((a, b) => a.ageDays - b.ageDays || a.sortOrder - b.sortOrder)
    .map((item) => {
      const dueOn = addDays(dateOfHatch, item.ageDays);
      const windowEndsOn = addDays(dueOn, Math.max(0, item.windowDays));
      const doneOn = doneByItem.get(item.id) ?? null;
      const daysFromDue = daysBetween(dueOn, asOf);

      let status: ScheduleStatus;
      if (doneOn) status = 'DONE';
      else if (options.closed) status = 'NOT_APPLICABLE';
      else if (startOfDay(asOf) > startOfDay(windowEndsOn)) status = 'OVERDUE';
      else if (startOfDay(asOf) >= startOfDay(dueOn)) status = 'DUE';
      else status = 'UPCOMING';

      return { item, dueOn, windowEndsOn, status, daysFromDue, doneOn };
    });
}

/** What needs doing now, soonest first. Nothing upcoming beyond `withinDays`. */
export function needsAttention(
  schedule: ScheduledEntry[],
  withinDays = 7,
): ScheduledEntry[] {
  return schedule
    .filter(
      (e) =>
        e.status === 'OVERDUE' ||
        e.status === 'DUE' ||
        (e.status === 'UPCOMING' && -e.daysFromDue <= withinDays),
    )
    .sort((a, b) => b.daysFromDue - a.daysFromDue);
}

/**
 * A sentence about one entry, written once so it reads the same everywhere.
 *
 * Says nothing about whether the intervention is a good idea — only whether the
 * date the farm's own programme set has arrived.
 */
export function scheduleSentence(entry: ScheduledEntry): string {
  const on = (d: Date) => d.toISOString().slice(0, 10);

  switch (entry.status) {
    case 'DONE':
      return `Given ${on(entry.doneOn!)}.`;
    case 'OVERDUE':
      return `Overdue — was due ${on(entry.dueOn)}, ${entry.daysFromDue} day${entry.daysFromDue === 1 ? '' : 's'} ago.`;
    case 'DUE':
      return `Due now (day ${entry.item.ageDays}, ${on(entry.dueOn)}).`;
    case 'UPCOMING':
      return `Due in ${-entry.daysFromDue} day${entry.daysFromDue === -1 ? '' : 's'}, on ${on(entry.dueOn)}.`;
    case 'NOT_APPLICABLE':
      return 'This flock is closed.';
  }
}

// ---------------------------------------------------------------------------
// WITHDRAWAL
// ---------------------------------------------------------------------------

export interface WithdrawalSource {
  name: string;
  occurredOn: Date;
  eggWithdrawalDays: number | null;
  meatWithdrawalDays: number | null;
}

export interface ActiveWithdrawal {
  name: string;
  kind: 'EGGS' | 'MEAT';
  treatedOn: Date;
  /** The last day on which the product must NOT be sold. */
  lastRestrictedDay: Date;
  /** The first day selling may resume. */
  clearsOn: Date;
  daysRemaining: number;
}

/**
 * The day sales may resume after a treatment.
 *
 * FORMULA: clearsOn = occurredOn + withdrawalDays
 *
 * The convention — and the one printed on product labels — is that a withdrawal
 * of seven days means the seven days FOLLOWING treatment are restricted, and the
 * eighth day is clear. So a treatment on the 1st with a 7-day withdrawal clears
 * on the 8th.
 *
 * Returns null when no withdrawal period was recorded. THAT IS NOT THE SAME AS
 * ZERO, and the difference is the point: "this product has no withdrawal" is a
 * claim only a label can make, and the system must not make it on the label's
 * behalf.
 */
export function withdrawalClearsOn(occurredOn: Date, withdrawalDays: number | null): Date | null {
  if (withdrawalDays === null || !Number.isFinite(withdrawalDays) || withdrawalDays < 0) {
    return null;
  }
  return addDays(occurredOn, withdrawalDays);
}

/**
 * Every withdrawal still in force on a given day.
 *
 * Overlapping treatments do not shorten each other: if two products are given a
 * week apart with different periods, the flock is restricted until the LAST one
 * clears. Taking the maximum is the only safe reading, and it is why this
 * returns every active restriction rather than a single date.
 */
export function activeWithdrawals(
  sources: WithdrawalSource[],
  asOf: Date,
): ActiveWithdrawal[] {
  const active: ActiveWithdrawal[] = [];

  for (const s of sources) {
    for (const [kind, days] of [
      ['EGGS', s.eggWithdrawalDays],
      ['MEAT', s.meatWithdrawalDays],
    ] as const) {
      const clearsOn = withdrawalClearsOn(s.occurredOn, days);
      if (!clearsOn) continue;
      if (startOfDay(asOf) >= startOfDay(clearsOn)) continue;

      active.push({
        name: s.name,
        kind,
        treatedOn: s.occurredOn,
        lastRestrictedDay: addDays(clearsOn, -1),
        clearsOn,
        daysRemaining: daysBetween(asOf, clearsOn),
      });
    }
  }

  return active.sort((a, b) => b.clearsOn.getTime() - a.clearsOn.getTime());
}

/** The single date a product type is clear again, or null if it is clear now. */
export function clearFor(
  withdrawals: ActiveWithdrawal[],
  kind: 'EGGS' | 'MEAT',
): Date | null {
  const relevant = withdrawals.filter((w) => w.kind === kind);
  if (relevant.length === 0) return null;
  return relevant.reduce((latest, w) => (w.clearsOn > latest ? w.clearsOn : latest), relevant[0].clearsOn);
}

/**
 * How many doses or millilitres a treatment needs.
 *
 * FORMULA: birds × dosePerBird, in the item's base unit.
 *
 * Deliberately NOT rounded up to a whole vial. A 1,000-dose vial opened for 940
 * birds leaves 60 doses that are, in practice, discarded — but that is a waste
 * figure the farm should see as waste, not something buried in the flock's
 * treatment cost as though the birds had received it.
 */
export function requiredQuantity(birds: number, dosePerBird: number | null): number | null {
  if (dosePerBird === null || !Number.isFinite(dosePerBird) || dosePerBird <= 0) return null;
  if (!Number.isFinite(birds) || birds <= 0) return null;
  return Math.round(birds * dosePerBird * 1000) / 1000;
}
