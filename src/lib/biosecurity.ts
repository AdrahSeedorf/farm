/**
 * Biosecurity — ADRAH Farms
 *
 * Three things a farm writes down to keep disease out: who came in, what was
 * cleaned and when, and what an inspection found. This module is the arithmetic
 * behind all three — elapsed hours, elapsed days, and what those numbers mean
 * against the farm's OWN rules. Pure; no database.
 *
 * THE SYSTEM DOES NOT DECIDE WHO MAY ENTER A POULTRY HOUSE.
 *
 *   It would be easy to write a function called `isSafeToEnter` and let a phone
 *   screen show a green tick. That would be wrong twice over. First, the inputs
 *   are DECLARATIONS — what a visitor said about where they had been — and this
 *   module can only ever report what was said, never what was true. Second, the
 *   downtime a farm requires is a judgement about local disease pressure, the
 *   season and who is visiting, and it belongs to the farm and its veterinarian.
 *
 *   So: no downtime period is shipped as a default. Until somebody sets one, the
 *   elapsed time is reported and NO verdict is given. A farm with no rule gets
 *   an honest blank, not a reassuring tick it did not earn.
 */

// ---------------------------------------------------------------------------
// DOWNTIME
// ---------------------------------------------------------------------------

export type DowntimeStatus =
  /** No rule has been set, so nothing can be judged against one. */
  | 'NO_RULE'
  /** The visitor did not say when they were last near other poultry. */
  | 'NOT_DECLARED'
  /** They said they have not been near other poultry at all. */
  | 'NO_CONTACT_DECLARED'
  /** Declared contact is more recent than the farm's own rule allows. */
  | 'WITHIN_DOWNTIME'
  /** Enough time has passed by the farm's own rule. */
  | 'PAST_DOWNTIME';

/**
 * What a visitor said about their last contact with other poultry.
 *
 * THREE STATES, NOT TWO. A nullable date can only say "a date" or "no date",
 * and "no date" would have to stand for both "they have not been near poultry"
 * and "nobody asked them" — two answers that mean opposite things. Modelling it
 * as a nullable field would have quietly merged the safest declaration with the
 * least informative one.
 */
export type ContactDeclaration =
  | { kind: 'NOT_DECLARED' }
  | { kind: 'NONE' }
  | { kind: 'AT'; at: Date };

export interface Downtime {
  status: DowntimeStatus;
  /** Hours between the declared contact and this arrival. Null when undeclared. */
  hoursSinceContact: number | null;
  /** The moment the farm's rule would be satisfied. Null without both inputs. */
  clearsAt: Date | null;
  /** Hours still to run. Null unless the status is WITHIN_DOWNTIME. */
  hoursRemaining: number | null;
}

export const MS_PER_HOUR = 3_600_000;

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_HOUR;
}

/**
 * How a visitor's declared last contact with other poultry stands against the
 * farm's downtime rule.
 *
 * FORMULA
 *   hoursSinceContact = arrivedAt − lastPoultryContact
 *   clearsAt          = lastPoultryContact + downtimeHours
 *   status            = PAST_DOWNTIME when hoursSinceContact >= downtimeHours
 *
 * NOT_DECLARED IS NOT THE SAME AS PAST_DOWNTIME, and the two must never collapse
 * into one another. A visitor who did not answer the question is an unknown; a
 * visitor who answered and cleared the rule is a known quantity. Treating the
 * first as the second is exactly how an unrecorded risk becomes an invisible
 * one — the same distinction the stock ledger draws between UNTRACKED and OK.
 */
export function downtimeFor(
  declaration: ContactDeclaration,
  arrivedAt: Date,
  downtimeHours: number | null,
): Downtime {
  const hasRule = downtimeHours !== null && Number.isFinite(downtimeHours) && downtimeHours > 0;

  const hoursSinceContact =
    declaration.kind === 'AT' ? hoursBetween(declaration.at, arrivedAt) : null;

  if (!hasRule) {
    return {
      status: 'NO_RULE',
      hoursSinceContact,
      clearsAt: null,
      hoursRemaining: null,
    };
  }

  // A declaration of no contact clears the downtime question outright, and is
  // reported as its own thing rather than as "past downtime". It is a different
  // claim, made by a different person, and six months from now the distinction
  // is the whole value of having written it down.
  if (declaration.kind === 'NONE') {
    return {
      status: 'NO_CONTACT_DECLARED',
      hoursSinceContact: null,
      clearsAt: null,
      hoursRemaining: null,
    };
  }

  if (declaration.kind === 'NOT_DECLARED') {
    return {
      status: 'NOT_DECLARED',
      hoursSinceContact: null,
      clearsAt: null,
      hoursRemaining: null,
    };
  }

  const clearsAt = new Date(declaration.at.getTime() + downtimeHours * MS_PER_HOUR);
  const remaining = hoursBetween(arrivedAt, clearsAt);

  return remaining > 0
    ? {
        status: 'WITHIN_DOWNTIME',
        hoursSinceContact,
        clearsAt,
        hoursRemaining: remaining,
      }
    : { status: 'PAST_DOWNTIME', hoursSinceContact, clearsAt, hoursRemaining: null };
}

/**
 * What the screen says about a visitor, in one sentence.
 *
 * Written as a statement of fact rather than an instruction. "They should not
 * enter" is the farm manager's call to make, not the software's — what the
 * software can say is how many hours have passed and what the farm's own rule
 * asks for.
 */
export function downtimeSentence(downtime: Downtime, downtimeHours: number | null): string {
  switch (downtime.status) {
    case 'NO_RULE':
      return downtime.hoursSinceContact === null
        ? 'No downtime rule is set for this farm, and no last contact was declared.'
        : `Last near other poultry ${describeHours(downtime.hoursSinceContact)} ago. ` +
            `No downtime rule is set for this farm, so there is nothing to measure that against.`;

    case 'NOT_DECLARED':
      return (
        `They did not say when they were last near other poultry. This farm asks for ` +
        `${downtimeHours} hours, and nothing here can tell whether that has passed.`
      );

    case 'NO_CONTACT_DECLARED':
      return 'They said they have not been near other poultry. Recorded as declared.';

    case 'WITHIN_DOWNTIME':
      return (
        `Last near other poultry ${describeHours(downtime.hoursSinceContact ?? 0)} ago — ` +
        `inside this farm's ${downtimeHours}-hour downtime, with ` +
        `${describeHours(downtime.hoursRemaining ?? 0)} still to run.`
      );

    case 'PAST_DOWNTIME':
      return (
        `Last near other poultry ${describeHours(downtime.hoursSinceContact ?? 0)} ago, ` +
        `past this farm's ${downtimeHours}-hour downtime.`
      );
  }
}

/** "36 hours", "2 days", "40 minutes" — whichever a person would actually say. */
export function describeHours(hours: number): string {
  const abs = Math.abs(hours);
  if (abs < 1) {
    const minutes = Math.max(1, Math.round(abs * 60));
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  if (abs < 48) {
    const whole = Math.round(abs);
    return `${whole} hour${whole === 1 ? '' : 's'}`;
  }
  const days = Math.round(abs / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// CLEANING & DISINFECTION
// ---------------------------------------------------------------------------

export type CleaningStatus =
  /** No interval has been set, so nothing is overdue or on time. */
  | 'UNTRACKED'
  /** Nothing has ever been recorded for this place. */
  | 'NEVER'
  | 'OK'
  | 'DUE'
  | 'OVERDUE';

/**
 * How long an interval may overrun before it reads as overdue rather than due.
 *
 * A grace band rather than a hard edge, because a weekly clean done on the
 * eighth day is a farm running slightly late, not a farm in trouble — and a
 * system that shouts on day eight gets ignored by day ten.
 */
export const CLEANING_GRACE_DAYS = 2;

export function daysSince(lastOn: Date, asOf: Date): number {
  return Math.floor((startOfDay(asOf) - startOfDay(lastOn)) / 86_400_000);
}

/**
 * Whether a place is due a clean.
 *
 * FORMULA
 *   days     = today − last cleaned
 *   OK       when days <  interval
 *   DUE      when days >= interval and days <= interval + grace
 *   OVERDUE  when days >  interval + grace
 *
 * UNTRACKED when no interval is set, and it is DELIBERATELY NOT "OK". A house
 * nobody has set a cleaning interval for is not a house that is up to date; it
 * is a house nobody is measuring. Reporting the two the same way would hide
 * every place that was never set up in among the ones that are fine.
 */
export function cleaningStatus(
  lastCleanedOn: Date | null,
  intervalDays: number | null,
  asOf: Date = new Date(),
): { status: CleaningStatus; days: number | null; overdueBy: number | null } {
  const hasInterval =
    intervalDays !== null && Number.isFinite(intervalDays) && intervalDays > 0;

  if (!hasInterval) {
    return {
      status: 'UNTRACKED',
      days: lastCleanedOn ? daysSince(lastCleanedOn, asOf) : null,
      overdueBy: null,
    };
  }
  if (!lastCleanedOn) return { status: 'NEVER', days: null, overdueBy: null };

  const days = daysSince(lastCleanedOn, asOf);
  const over = days - intervalDays;

  if (over < 0) return { status: 'OK', days, overdueBy: null };
  if (over <= CLEANING_GRACE_DAYS) return { status: 'DUE', days, overdueBy: over };
  return { status: 'OVERDUE', days, overdueBy: over };
}

export function cleaningSentence(
  result: ReturnType<typeof cleaningStatus>,
  intervalDays: number | null,
): string {
  switch (result.status) {
    case 'UNTRACKED':
      return result.days === null
        ? 'No cleaning interval set, and nothing recorded.'
        : `Last cleaned ${result.days} day${result.days === 1 ? '' : 's'} ago. ` +
            `No interval is set, so nothing here is calling it due.`;
    case 'NEVER':
      return `Nothing recorded yet. This farm cleans every ${intervalDays} days.`;
    case 'OK':
      return `Cleaned ${result.days} day${result.days === 1 ? '' : 's'} ago, inside the ${intervalDays}-day interval.`;
    case 'DUE':
      return `Due — ${result.days} days since the last clean, against an interval of ${intervalDays}.`;
    case 'OVERDUE':
      return `Overdue by ${result.overdueBy} day${result.overdueBy === 1 ? '' : 's'} — ${result.days} days since the last clean.`;
  }
}

// ---------------------------------------------------------------------------
// INSPECTIONS
// ---------------------------------------------------------------------------

export type CheckResult = 'PASS' | 'FAIL' | 'NOT_CHECKED' | 'NOT_APPLICABLE';

export interface CheckLine {
  key: string;
  label: string;
  result: CheckResult;
  note?: string | null;
}

export interface CheckSummary {
  passed: number;
  failed: number;
  notChecked: number;
  notApplicable: number;
  /** Everything that failed, for the list that has to be acted on. */
  failures: CheckLine[];
  /**
   * Share of the applicable items that passed, 0–100.
   *
   * Null when nothing applicable was checked — a score of 0% for an inspection
   * nobody carried out reads as a catastrophic result rather than as an absent
   * one, and somebody would act on it.
   */
  scorePct: number | null;
}

/**
 * What an inspection found.
 *
 * NOT_CHECKED IS COUNTED AND REPORTED, never quietly folded into a pass. A
 * checklist where half the lines were skipped is a different document from one
 * where every line passed, and the difference is exactly what a person reading
 * it next month needs to see.
 */
export function summariseChecks(lines: CheckLine[]): CheckSummary {
  const passed = lines.filter((l) => l.result === 'PASS').length;
  const failures = lines.filter((l) => l.result === 'FAIL');
  const notChecked = lines.filter((l) => l.result === 'NOT_CHECKED').length;
  const notApplicable = lines.filter((l) => l.result === 'NOT_APPLICABLE').length;

  const judged = passed + failures.length;

  return {
    passed,
    failed: failures.length,
    notChecked,
    notApplicable,
    failures,
    scorePct: judged === 0 ? null : (passed / judged) * 100,
  };
}

/** One line describing an inspection, for a list of them. */
export function checkSentence(summary: CheckSummary): string {
  if (summary.scorePct === null) {
    return `Nothing was checked — ${summary.notChecked} item${summary.notChecked === 1 ? '' : 's'} left blank.`;
  }

  const parts = [`${summary.passed} passed`];
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  if (summary.notChecked > 0) parts.push(`${summary.notChecked} not checked`);

  return parts.join(', ') + '.';
}

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
