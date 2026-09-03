import {
  averageBirdsAlive,
  henDayProductionPct,
  henHousedProduction,
  saleableRatePct,
  ageAtLayThreshold,
  peakLay,
  type DailyLayPoint,
} from '@/lib/metrics';

/**
 * Production arithmetic — ADRAH Farms
 *
 * What came out of a group, how it graded, and how that compares with the day
 * before and with the breed's published curve. Pure arithmetic; no database.
 *
 * NOTHING HERE KNOWS WHAT AN EGG IS. Grades arrive as data — a key, a name and
 * whether the farm can sell it — so "Large", "Cracked" and "Floor" are rows in a
 * table the farm edits, not values in an enum a developer chose. The same
 * machinery counts piglets weaned or litres of milk; only the grade rows change.
 *
 * EVERY PRODUCTION FORMULA IS IMPORTED FROM metrics.ts, NEVER RE-WRITTEN HERE.
 * Hen-day production is computed in exactly one place in this codebase, and it
 * is not this file. What lives here is the arithmetic ABOVE those formulas:
 * summing collections into a day, days into a week, and lines into a grade
 * breakdown.
 *
 * THE ONE IDEA THAT MATTERS HERE — a day is made of several collections.
 *
 *   Eggs are collected two or three times a day. That is not one record with a
 *   number in it; it is several records, each written by whoever walked the
 *   house, and the day's figure is their sum. Modelling the day as a single
 *   editable total would mean the second collection overwrites the first, which
 *   is the one thing this architecture never allows.
 */

// ---------------------------------------------------------------------------
// GRADES AND WHAT WAS COLLECTED
// ---------------------------------------------------------------------------

export interface Grade {
  key: string;
  name: string;
  /** Whether the farm can sell it. Cracked, dirty and floor eggs cannot. */
  isSaleable: boolean;
  sortOrder: number;
}

/** One grade's share of a single collection. */
export interface OutputLine {
  gradeKey: string;
  quantity: number;
}

export interface Collection {
  /** Which collection of the day this was: 1, 2, 3. */
  sequence: number;
  /**
   * What was counted in the house, before anything was graded.
   *
   * Null when only the graded lines were entered — a farm that grades as it
   * collects has one number, not two.
   */
  countedQuantity: number | null;
  lines: OutputLine[];
}

export interface GradeTotal {
  key: string;
  name: string;
  isSaleable: boolean;
  quantity: number;
  /** Share of everything counted in this set, 0–100. Null when there is none. */
  sharePct: number | null;
}

/** Everything on a set of lines, whatever it graded as. */
export function totalOf(lines: OutputLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

/**
 * What one collection produced.
 *
 * THE COUNTED FIGURE WINS when there is one, because it was taken closest to the
 * birds. Eggs break between the house and the egg room, and if grading is where
 * the count comes from then that breakage silently becomes eggs the hens never
 * laid — which drags hen-day production down and blames the flock for a handling
 * problem. The gap between the two figures is itself worth seeing; see
 * `reconcile`.
 */
export function collectionTotal(collection: Collection): number {
  return collection.countedQuantity ?? totalOf(collection.lines);
}

/** A whole day, across every collection recorded for it. */
export function dayTotal(collections: Collection[]): number {
  return collections.reduce((sum, c) => sum + collectionTotal(c), 0);
}

/**
 * The grade breakdown, in the farm's own order.
 *
 * ORDERED BY THE GRADE'S OWN sortOrder, not by size — unlike the cost breakdown
 * in `flock-costing.byCategory`, which sorts largest-first because the question
 * there is "where is the money going". The question here is "how did today
 * grade", and the answer only reads properly in a fixed order: the same grades
 * in the same places every day, so a change in shape is visible at a glance.
 *
 * A LINE WHOSE GRADE IS NO LONGER IN THE LIST STILL APPEARS, under its own key.
 * A grade that was renamed or retired must never make eggs vanish out of a
 * total — the row would simply be dropped, the figures would stop adding up, and
 * nobody would know why.
 */
export function gradeTotals(lines: OutputLine[], grades: Grade[]): GradeTotal[] {
  const byKey = new Map<string, number>();
  for (const line of lines) {
    byKey.set(line.gradeKey, (byKey.get(line.gradeKey) ?? 0) + line.quantity);
  }

  const total = totalOf(lines);
  const share = (quantity: number) => (total > 0 ? (quantity / total) * 100 : null);

  const known = [...grades]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((grade) => byKey.has(grade.key))
    .map((grade) => ({
      key: grade.key,
      name: grade.name,
      isSaleable: grade.isSaleable,
      quantity: byKey.get(grade.key) ?? 0,
      sharePct: share(byKey.get(grade.key) ?? 0),
    }));

  const knownKeys = new Set(grades.map((g) => g.key));
  const orphans = [...byKey.entries()]
    .filter(([key]) => !knownKeys.has(key))
    .map(([key, quantity]) => ({
      key,
      // Shown as the raw key, which looks wrong on screen on purpose: a grade
      // nobody can name is a configuration problem someone should fix.
      name: key,
      isSaleable: false,
      quantity,
      sharePct: share(quantity),
    }));

  return [...known, ...orphans];
}

/** How much of this graded into something the farm can sell. */
export function saleableOf(lines: OutputLine[], grades: Grade[]): number {
  const saleable = new Set(grades.filter((g) => g.isSaleable).map((g) => g.key));
  return lines.reduce((sum, line) => (saleable.has(line.gradeKey) ? sum + line.quantity : sum), 0);
}

/**
 * How much did not — cracked, dirty, floor-laid, undersized.
 *
 * A line whose grade is unknown counts as NOT saleable. Guessing the other way
 * would put an unidentifiable egg into the saleable figure, and the saleable
 * figure is what a price gets multiplied by.
 */
export function rejectedOf(lines: OutputLine[], grades: Grade[]): number {
  return totalOf(lines) - saleableOf(lines, grades);
}

/**
 * Saleable rate %.
 *
 * FORMULA: saleable ÷ everything collected × 100 — see `metrics.saleableRatePct`.
 *
 * The number that turns a good-looking collection into a good day. 1,900 eggs
 * with 9% cracked is not 1,900 eggs, and only this figure says so.
 */
export function saleableRate(lines: OutputLine[], grades: Grade[]): number | null {
  return saleableRatePct(saleableOf(lines, grades), totalOf(lines));
}

export interface Reconciliation {
  counted: number;
  graded: number;
  /** graded − counted. Negative means fewer arrived than left the house. */
  difference: number;
}

/**
 * The house count against the grading bench.
 *
 * WHY THE DIFFERENCE IS KEPT RATHER THAN RESOLVED
 *   When a farm counts eggs in the house and grades them somewhere else, the two
 *   numbers disagree, and the disagreement is a measurement — of eggs broken in
 *   the trays, of a miscount, or of a collection that was graded twice. Picking
 *   one figure and discarding the other throws that away. Both are recorded,
 *   the difference is shown, and a person decides what it means.
 *
 * Returns null when nothing was counted separately, which is the ordinary case
 * for a farm that grades as it collects.
 */
export function reconcile(counted: number | null, lines: OutputLine[]): Reconciliation | null {
  if (counted === null) return null;
  const graded = totalOf(lines);
  return { counted, graded, difference: graded - counted };
}

// ---------------------------------------------------------------------------
// THE LAY CURVE
// ---------------------------------------------------------------------------

export interface DayOfLay {
  onDate: Date;
  ageDays: number;
  /** Everything collected that day, across every collection. */
  eggs: number;
  openingBirds: number;
  closingBirds: number;
}

/**
 * Daily hen-day production, in the order the days happened.
 *
 * FORMULA per day: eggs ÷ ((opening birds + closing birds) ÷ 2) × 100
 * — `metrics.henDayProductionPct`.
 */
export function henDaySeries(days: DayOfLay[]): DailyLayPoint[] {
  return [...days]
    .sort((a, b) => a.onDate.getTime() - b.onDate.getTime())
    .map((day) => ({
      ageDays: day.ageDays,
      henDayPct: henDayProductionPct(day.eggs, day.openingBirds, day.closingBirds),
    }));
}

export interface LayWeek {
  ageWeeks: number;
  eggs: number;
  /** Sum of the average birds alive on each day in the week. */
  birdDays: number;
  henDayPct: number | null;
  /** How many days of this week actually have a record. */
  daysRecorded: number;
}

/**
 * Production by age in weeks — how layer performance is reported everywhere.
 *
 * FORMULA: eggs in the week ÷ bird-days in the week × 100
 *   where bird-days = Σ (opening + closing) ÷ 2 for each day recorded.
 *
 * NOT THE AVERAGE OF THE DAILY PERCENTAGES. Averaging percentages gives a day
 * with 400 birds the same weight as a day with 4,000, so a week containing a
 * heavy mortality event would report a figure that never happened. Dividing the
 * week's eggs by the week's bird-days is the same arithmetic as the daily
 * figure, one level up, and the two always agree.
 *
 * `daysRecorded` is carried through so a screen can say the week is incomplete
 * rather than presenting six days of eggs as though they were seven.
 */
export function weeklyLay(days: DayOfLay[]): LayWeek[] {
  const weeks = new Map<number, { eggs: number; birdDays: number; daysRecorded: number }>();

  for (const day of days) {
    const week = Math.floor(day.ageDays / 7);
    const bucket = weeks.get(week) ?? { eggs: 0, birdDays: 0, daysRecorded: 0 };
    bucket.eggs += day.eggs;
    bucket.birdDays += averageBirdsAlive(day.openingBirds, day.closingBirds);
    bucket.daysRecorded += 1;
    weeks.set(week, bucket);
  }

  return [...weeks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ageWeeks, bucket]) => ({
      ageWeeks,
      eggs: bucket.eggs,
      birdDays: bucket.birdDays,
      henDayPct: bucket.birdDays > 0 ? (bucket.eggs / bucket.birdDays) * 100 : null,
      daysRecorded: bucket.daysRecorded,
    }));
}

/** Everything this group has produced, over the days supplied. */
export function cumulativeOutput(days: DayOfLay[]): number {
  return days.reduce((sum, day) => sum + day.eggs, 0);
}

/**
 * Eggs per bird ORIGINALLY HOUSED — `metrics.henHousedProduction`.
 *
 * FORMULA: cumulative eggs ÷ birds placed
 *
 * The economic figure, as against the biological one. Hen-day flatters a flock
 * that lost a third of its birds, because the survivors are laying well. Hen-
 * housed charges those birds against the result, which is what the money did.
 */
export function henHoused(days: DayOfLay[], birdsPlaced: number): number | null {
  return henHousedProduction(cumulativeOutput(days), birdsPlaced);
}

/**
 * The conventional milestones of a laying cycle.
 *
 * 5% is the industry's definition of the onset of lay, and 50% is the point a
 * flock is genuinely in production. They are REPORTING CONVENTIONS, not
 * standards this system holds an opinion about, which is why they are an
 * argument with a documented default rather than a constant in the code.
 */
export const LAY_MILESTONE_THRESHOLDS: readonly number[] = [5, 50];

export interface LayMilestones {
  thresholds: { thresholdPct: number; ageDays: number | null }[];
  peak: { ageDays: number; henDayPct: number } | null;
}

export function layMilestones(
  series: DailyLayPoint[],
  thresholds: readonly number[] = LAY_MILESTONE_THRESHOLDS,
): LayMilestones {
  return {
    thresholds: thresholds.map((thresholdPct) => ({
      thresholdPct,
      ageDays: ageAtLayThreshold(series, thresholdPct),
    })),
    peak: peakLay(series),
  };
}

// ---------------------------------------------------------------------------
// AGAINST THE BREED'S PUBLISHED CURVE
// ---------------------------------------------------------------------------

/**
 * A breeder's published lay curve: age in days → hen-day production %.
 *
 * Stored in `Breed.standards.henDayPctByAgeDays`, per BREED — for the same
 * reason the body-weight curve is (see `rearing.ts`). An ISA Brown and a
 * Lohmann Brown are both layers and do not lay the same at 30 weeks, so a shared
 * "layer" curve would report a healthy flock as behind target.
 *
 * THE FIGURES ARE NOT SHIPPED. They come from the breeder's own management guide
 * via `npm run standards:load`, and a breed with none reports no comparison
 * rather than being scored against a guess.
 */
export type LayStandard = Record<number, number>;

/**
 * Target hen-day % at an age, interpolating linearly between published points.
 *
 * Deliberately its own implementation rather than a shared one with
 * `rearing.standardWeightAt`: that curve is whole grams read off a rearing
 * guide, this one is a percentage to one decimal read off a production table,
 * and they are loaded from different columns of different documents. Two short
 * functions that can be read on their own beat one generic one that has to be
 * understood twice.
 *
 * Returns null outside the published range rather than extrapolating. A guess
 * beyond the data is exactly the kind of number that later gets quoted as fact.
 */
export function standardHenDayAt(ageDays: number, standard: LayStandard): number | null {
  const points = Object.entries(standard)
    .map(([age, pct]) => ({ age: Number(age), pct }))
    .filter((p) => Number.isFinite(p.age) && Number.isFinite(p.pct))
    .sort((a, b) => a.age - b.age);

  if (points.length === 0) return null;
  if (ageDays < points[0].age || ageDays > points[points.length - 1].age) return null;

  const exact = points.find((p) => p.age === ageDays);
  if (exact) return exact.pct;

  const after = points.findIndex((p) => p.age > ageDays);
  const lower = points[after - 1];
  const upper = points[after];
  const span = upper.age - lower.age;
  if (span === 0) return lower.pct;

  const ratio = (ageDays - lower.age) / span;
  return Math.round((lower.pct + ratio * (upper.pct - lower.pct)) * 10) / 10;
}

/** Read a lay curve out of a breed's configured standards. */
export function layStandardFrom(standards: unknown): LayStandard {
  if (!standards || typeof standards !== 'object') return {};
  const raw = (standards as Record<string, unknown>).henDayPctByAgeDays;
  if (!raw || typeof raw !== 'object') return {};

  const out: LayStandard = {};
  for (const [age, pct] of Object.entries(raw as Record<string, unknown>)) {
    const a = Number(age);
    const p = Number(pct);
    // A hen lays at most one egg a day, so hen-day production cannot exceed 100.
    // A table that says otherwise has been read out of the wrong column.
    if (Number.isFinite(a) && Number.isFinite(p) && a >= 0 && p >= 0 && p <= 100) out[a] = p;
  }
  return out;
}

/**
 * How far off the published curve a flock is, IN PERCENTAGE POINTS.
 *
 * FORMULA: actual hen-day % − standard hen-day %
 *
 * Points, not a ratio. "8 points behind standard" is a sentence a farm manager
 * can act on; "91% of standard" is a percentage of a percentage, and the two get
 * confused with each other on exactly the screens where it matters. Body weight
 * is reported the other way round (`metrics.bodyWeightVsStandardPct`) because
 * grams are not already a percentage.
 *
 * Negative is behind, positive is ahead. Null when there is no curve loaded for
 * the breed, or the flock's age falls outside it.
 */
export function henDayVsStandardPoints(
  actualPct: number | null,
  standardPct: number | null,
): number | null {
  if (actualPct === null || standardPct === null) return null;
  return Math.round((actualPct - standardPct) * 10) / 10;
}

// ---------------------------------------------------------------------------
// WHAT HAS NOT BEEN RECORDED
// ---------------------------------------------------------------------------

/**
 * Days in a window with no collection recorded at all.
 *
 * A production total that quietly omits four unrecorded days is a total that
 * understates the flock and nobody can see why. This is what lets a screen say
 * "4 of these 30 days have no record, so these figures are lower than the
 * truth" — the same rule as the cost screen naming the categories nobody has
 * entered.
 *
 * Both bounds inclusive; dates are compared by calendar day, in UTC, the way
 * every other date in this system is.
 */
export function missingDays(recorded: Date[], from: Date, to: Date): Date[] {
  const have = new Set(recorded.map((d) => startOfDay(d)));
  const first = startOfDay(from);
  const last = startOfDay(to);
  if (last < first) return [];

  const gaps: Date[] = [];
  for (let t = first; t <= last; t += 86_400_000) {
    if (!have.has(t)) gaps.push(new Date(t));
  }
  return gaps;
}

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
