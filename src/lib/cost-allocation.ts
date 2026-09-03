import { allocateByWeights, formatGHS, pesewas } from '@/lib/money';
import { populationAsOf, type PopulationEvent } from '@/lib/ledger';
import { CATEGORY_LABELS, type CostCategory } from '@/lib/flock-costing';
import type { Warning } from '@/lib/warnings';

/**
 * Cost allocation — ADRAH Farms
 *
 * Some costs belong to one flock and some belong to the farm. A bag of feed
 * goes to the birds that eat it. A month's wages, the electricity bill, the
 * lorry hired to bring both — those are paid once and worked for every flock on
 * the site, and somebody has to decide how much of each one each flock carries.
 *
 * THE PROBLEM THIS MODULE EXISTS TO SOLVE
 *   Left alone, a farm answers this by not answering it: shared costs stay in a
 *   notebook, never reach any flock, and the cost per pullet comes out
 *   confidently low. The birds look cheaper to rear than they were, and the
 *   decision that figure was gathered for — rear or buy — is made on a number
 *   that left out the wages.
 *
 * WHAT IT DOES NOT DO
 *   It does not decide which method is right. There is no universally correct
 *   way to divide an electricity bill between two houses, and a system that
 *   picked one silently would be asserting an accounting opinion it has no
 *   business holding. It offers four methods, states the formula for each in
 *   plain words on the screen, records which one was used, and keeps each
 *   flock's weight so the split can be checked years later.
 *
 * Pure arithmetic. No database.
 */

export const ALLOCATION_METHODS = ['BIRD_DAYS', 'HEADCOUNT', 'EQUAL', 'MANUAL'] as const;
export type AllocationMethod = (typeof ALLOCATION_METHODS)[number];

/**
 * The default, and the one to reach for unless there is a reason not to.
 *
 * A flock placed on the 25th of the month was on the farm for six days of it.
 * Bird-days is the only method that notices.
 */
export const DEFAULT_METHOD: AllocationMethod = 'BIRD_DAYS';

export const METHOD_LABELS: Record<AllocationMethod, string> = {
  BIRD_DAYS: 'By bird-days',
  HEADCOUNT: 'By bird count',
  EQUAL: 'Equally',
  MANUAL: 'I will type each share',
};

/**
 * What each method actually does, in the words shown beside it on the form.
 *
 * These are not tooltips. Whoever divides a wage bill between two flocks is
 * making a judgement that will show up in the cost per pullet six months later,
 * and they are entitled to know exactly what the arithmetic is before they
 * choose.
 */
export const METHOD_EXPLANATION: Record<AllocationMethod, string> = {
  BIRD_DAYS:
    'Each flock takes a share in proportion to the number of birds it had, ' +
    'multiplied by the days it had them. A flock placed halfway through the ' +
    'period takes about half as much as one that was there throughout.',
  HEADCOUNT:
    'Each flock takes a share in proportion to how many birds it had on the ' +
    'day of the cost. Simpler than bird-days, but it treats a flock placed ' +
    'yesterday the same as one that has been eating all month.',
  EQUAL:
    'Every selected flock takes the same amount, whatever its size. Right for ' +
    'a cost that does not scale with birds — a licence, a site inspection.',
  MANUAL:
    'You type each flock’s share yourself. The shares must add up to the ' +
    'total, and nothing is rounded on your behalf.',
};

/** Only a bird-days split needs a window; the others take a single date. */
export function methodNeedsPeriod(method: AllocationMethod): boolean {
  return method === 'BIRD_DAYS';
}

// ---------------------------------------------------------------------------
// CATEGORIES THAT ALREADY HAVE A SOURCE
// ---------------------------------------------------------------------------

/**
 * Categories that are already written automatically, and by what.
 *
 * Recording a bag of feed here as well as issuing it from the store charges the
 * flock twice. That is not blocked — there are real feed costs the store never
 * sees, milling being the obvious one — but it is said out loud before saving,
 * because a double-counted cost is invisible afterwards and drags every figure
 * built on top of it.
 */
export const AUTOMATIC_SOURCES: Partial<Record<CostCategory, string>> = {
  FEED: 'feed issued to a flock on its daily record',
  HEALTH: 'treatments taken from the store when a health event is recorded',
  STOCK_PURCHASE: 'the price entered when the flock was placed',
};

export function automaticSourceWarning(category: CostCategory): Warning | null {
  const source = AUTOMATIC_SOURCES[category];
  if (!source) return null;
  return {
    field: 'category',
    message:
      `${CATEGORY_LABELS[category]} cost is already recorded from ${source}. Enter it ` +
      `here only for something that never passed through there — a call-out fee, a ` +
      `milling charge — or the flock is charged twice.`,
  };
}

// ---------------------------------------------------------------------------
// BIRD-DAYS
// ---------------------------------------------------------------------------

/**
 * Bird-days over a window, inclusive of both ends.
 *
 * FORMULA
 *   birdDays = Σ over each day d from `from` to `to` of population(d)
 *
 * where population(d) is the running sum of the flock's ledger up to the end of
 * day d — the same derivation used everywhere else, so this figure can never
 * disagree with the bird count on the flock screen.
 *
 * A flock that held 500 birds for all 30 days of a month has 15,000 bird-days.
 * One placed on the 25th with 500 birds has 3,000. That ratio is what makes a
 * wage bill land in roughly the right proportions.
 */
export function birdDaysBetween(events: PopulationEvent[], from: Date, to: Date): number {
  const start = startOfDay(from);
  const end = startOfDay(to);
  if (end < start) return 0;

  let total = 0;
  for (let day = start; day <= end; day += DAY_MS) {
    total += Math.max(0, populationAsOf(events, new Date(day)));
  }
  return total;
}

/** Whole days from one date to another, inclusive of both. */
export function daysInPeriod(from: Date, to: Date): number {
  const span = (startOfDay(to) - startOfDay(from)) / DAY_MS;
  return span < 0 ? 0 : span + 1;
}

// ---------------------------------------------------------------------------
// THE SPLIT
// ---------------------------------------------------------------------------

export interface AllocationTarget {
  flockId: string;
  /** House name or flock code — what the person recognises on screen. */
  label: string;
  /** Bird-days over the period. Zero when the flock was not on the farm. */
  birdDays: number;
  /** Birds alive on the date of the cost. */
  headcount: number;
  /** Only for MANUAL: this flock's share, in pesewas, as typed. */
  manualPesewas?: number;
}

export interface AllocationLine {
  flockId: string;
  label: string;
  /** The number this flock was weighted by, under the chosen method. */
  weight: number;
  pesewas: number;
  /** Share of the total, 0–100. Null when there is no total to divide. */
  sharePct: number | null;
}

/**
 * The weight each flock carries, by method.
 *
 *   BIRD_DAYS  weight = bird-days in the period
 *   HEADCOUNT  weight = birds alive on the date of the cost
 *   EQUAL      weight = 1
 *   MANUAL     weight = the amount typed (its own weight, by definition)
 */
export function weightsFor(method: AllocationMethod, targets: AllocationTarget[]): number[] {
  switch (method) {
    case 'BIRD_DAYS':
      return targets.map((t) => Math.max(0, t.birdDays));
    case 'HEADCOUNT':
      return targets.map((t) => Math.max(0, t.headcount));
    case 'EQUAL':
      return targets.map(() => 1);
    case 'MANUAL':
      return targets.map((t) => t.manualPesewas ?? 0);
  }
}

/**
 * Divide a cost between flocks.
 *
 * The pesewa arithmetic is `allocateByWeights` in the money module, which
 * distributes the remainder to the largest fractional losers so the parts sum
 * EXACTLY to the total. A naive `total × weight ÷ sum` would leak a pesewa or
 * two on most splits, and a cost ledger that does not add up to the bill is a
 * cost ledger nobody will trust for long.
 *
 * MANUAL is not divided at all — the typed amounts are used as given, having
 * already been checked to sum to the total. Rounding someone's own figures on
 * their behalf would be worse than refusing them.
 */
export function splitAllocation(
  totalPesewas: number,
  method: AllocationMethod,
  targets: AllocationTarget[],
): AllocationLine[] {
  if (targets.length === 0) return [];

  const weights = weightsFor(method, targets);

  const amounts =
    method === 'MANUAL'
      ? targets.map((t) => Math.round(t.manualPesewas ?? 0))
      : allocateByWeights(pesewas(Math.round(totalPesewas)), weights);

  const total = amounts.reduce((s, a) => s + a, 0);

  return targets.map((t, i) => ({
    flockId: t.flockId,
    label: t.label,
    weight: weights[i],
    pesewas: amounts[i],
    sharePct: total === 0 ? null : (amounts[i] / total) * 100,
  }));
}

/** What the manual shares add up to — the number that must match the bill. */
export function manualTotal(targets: AllocationTarget[]): number {
  return targets.reduce((sum, t) => sum + Math.round(t.manualPesewas ?? 0), 0);
}

// ---------------------------------------------------------------------------
// CHECKS
// ---------------------------------------------------------------------------

export interface AllocationInput {
  category: CostCategory;
  totalPesewas: number;
  method: AllocationMethod;
  targets: AllocationTarget[];
  periodStart?: Date | null;
  periodEnd?: Date | null;
}

/**
 * Reasons the split cannot be written at all. These block.
 *
 * Kept separate from the warnings below because they are different in kind: a
 * warning says "this looks wrong, are you sure"; an error says "this does not
 * add up, and saving it would put a number in the ledger that is not the number
 * on the invoice".
 */
export function allocationErrors(input: AllocationInput): string[] {
  const errors: string[] = [];

  if (input.targets.length === 0) {
    errors.push('Choose at least one flock to carry this cost.');
  }

  if (input.totalPesewas <= 0) {
    errors.push('The amount must be more than zero.');
  }

  if (methodNeedsPeriod(input.method) && (!input.periodStart || !input.periodEnd)) {
    errors.push('A bird-days split needs the period the cost covers.');
  }

  if (input.periodStart && input.periodEnd && input.periodEnd < input.periodStart) {
    errors.push('The period ends before it starts.');
  }

  if (input.method === 'MANUAL') {
    const typed = manualTotal(input.targets);
    if (typed !== input.totalPesewas) {
      const short = input.totalPesewas - typed;
      errors.push(
        `The shares add up to ${formatGHS(pesewas(typed))}, not ${formatGHS(
          pesewas(input.totalPesewas),
        )} — ${short > 0 ? `${formatGHS(pesewas(short))} short` : `${formatGHS(pesewas(-short))} over`}.`,
      );
    }
  }

  return errors;
}

/**
 * Things worth saying before saving, none of which stop the save.
 *
 * The house rule, applied here as everywhere: warn, never block. The person
 * standing in front of the screen knows things the database does not.
 */
export function checkAllocation(input: AllocationInput): Warning[] {
  const warnings: Warning[] = [];

  const automatic = automaticSourceWarning(input.category);
  if (automatic) warnings.push(automatic);

  const weights = weightsFor(input.method, input.targets);
  const weightTotal = weights.reduce((s, w) => s + w, 0);

  if (input.method !== 'MANUAL' && input.method !== 'EQUAL') {
    const basis = input.method === 'BIRD_DAYS' ? 'no birds in this period' : 'no birds on this date';

    if (weightTotal === 0) {
      warnings.push({
        field: 'method',
        message:
          `Every flock selected had ${basis}, so there is nothing to weigh the ` +
          `split by. The cost will be divided equally instead. Check the dates.`,
      });
    } else {
      const empty = input.targets.filter((_, i) => weights[i] === 0);
      for (const t of empty) {
        warnings.push({
          field: 'targets',
          message: `${t.label} had ${basis}, so it will carry none of this cost.`,
        });
      }
    }
  }

  if (input.periodStart && input.periodEnd) {
    const days = daysInPeriod(input.periodStart, input.periodEnd);
    if (days > 92) {
      warnings.push({
        field: 'periodEnd',
        message:
          `That period is ${days} days. A cost spread over more than a quarter ` +
          `lands on flocks that were placed and sold inside it — check the dates ` +
          `are the ones you meant.`,
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// SAYING WHAT WAS DONE
// ---------------------------------------------------------------------------

/**
 * One sentence describing the split, for the confirmation screen and for the
 * description stored on each flock's cost entry.
 *
 * The entry a flock carries should explain itself without anyone opening
 * another screen — "Electricity, July (1 of 3 flocks, by bird-days)" is a line
 * a manager can act on; "Allocation 7f3a9c" is not.
 */
export function allocationSentence(
  totalPesewas: number,
  method: AllocationMethod,
  lines: AllocationLine[],
): string {
  if (lines.length === 0) return 'Nothing to divide.';

  const total = formatGHS(pesewas(Math.round(totalPesewas)));

  if (lines.length === 1) {
    return `${total}, all of it to ${lines[0].label}.`;
  }

  const how =
    method === 'BIRD_DAYS'
      ? 'by bird-days'
      : method === 'HEADCOUNT'
        ? 'by bird count'
        : method === 'EQUAL'
          ? 'equally'
          : 'as typed';

  const parts = lines
    .map((l) => `${l.label} ${formatGHS(pesewas(l.pesewas))}`)
    .join(', ');

  return `${total} across ${lines.length} flocks ${how} — ${parts}.`;
}

/** The description written onto one flock's share. */
export function entryDescription(
  description: string,
  method: AllocationMethod,
  lineCount: number,
): string {
  if (lineCount <= 1) return description;
  const how =
    method === 'BIRD_DAYS'
      ? 'by bird-days'
      : method === 'HEADCOUNT'
        ? 'by bird count'
        : method === 'EQUAL'
          ? 'split equally'
          : 'share entered by hand';
  return `${description} — 1 of ${lineCount} flocks, ${how}`;
}

/** How a weight reads on screen, which depends entirely on what it counted. */
export function weightLabel(method: AllocationMethod, weight: number): string {
  switch (method) {
    case 'BIRD_DAYS':
      return `${Math.round(weight).toLocaleString('en-GH')} bird-days`;
    case 'HEADCOUNT':
      return `${Math.round(weight).toLocaleString('en-GH')} birds`;
    case 'EQUAL':
      return 'equal share';
    case 'MANUAL':
      return 'entered by hand';
  }
}

const DAY_MS = 86_400_000;

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
