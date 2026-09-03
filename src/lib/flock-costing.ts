import { pesewas, type Pesewas } from '@/lib/money';

/**
 * Flock costing — ADRAH Farms
 *
 * What a flock has cost, and what each bird in it has cost. Pure arithmetic; no
 * database. Every formula is written out so a farm manager can check it against
 * their own paper, which is the only way a costing figure ever gets trusted.
 *
 * THE ONE IDEA THAT MATTERS HERE — the cost of a dead bird does not disappear.
 *
 *   Feed eaten by a chick that died on day nine was still bought and still paid
 *   for. Dividing total cost by the birds STILL ALIVE loads that spend onto the
 *   survivors, which is exactly right: it is what each surviving bird has
 *   actually cost the business. A flock with 12% mortality genuinely has a
 *   higher cost per pullet than one with 4%, and a costing system that hid that
 *   would hide the single most expensive thing that can go wrong in rearing.
 */

export const COST_CATEGORIES = [
  'STOCK_PURCHASE',
  'FEED',
  'HEALTH',
  'LABOUR',
  'UTILITIES',
  'TRANSPORT',
  'OTHER',
] as const;

export type CostCategory = (typeof COST_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<CostCategory, string> = {
  STOCK_PURCHASE: 'Chicks',
  FEED: 'Feed',
  HEALTH: 'Health',
  LABOUR: 'Labour',
  UTILITIES: 'Utilities',
  TRANSPORT: 'Transport',
  OTHER: 'Other',
};

export interface CostEntry {
  category: CostCategory;
  amountPesewas: number;
  incurredOn: Date;
}

export interface CategoryTotal {
  category: CostCategory;
  label: string;
  pesewas: number;
  /** Share of the total, 0–100. Null when there is no total to divide by. */
  sharePct: number | null;
}

/** Total spend, in integer pesewas. */
export function totalCost(entries: CostEntry[]): Pesewas {
  return pesewas(entries.reduce((sum, e) => sum + e.amountPesewas, 0));
}

/** Spend up to and including a date — for "what had it cost by point of lay". */
export function costUpTo(entries: CostEntry[], on: Date): Pesewas {
  const cutoff = startOfDay(on);
  return pesewas(
    entries.reduce((sum, e) => (startOfDay(e.incurredOn) <= cutoff ? sum + e.amountPesewas : sum), 0),
  );
}

/**
 * Spend by category, largest first, with each share of the total.
 *
 * Ordered by size rather than by the enum, because the question this answers is
 * "where is the money going" and the answer is almost always feed — but a month
 * where it is not is a month worth looking at.
 */
export function byCategory(entries: CostEntry[]): CategoryTotal[] {
  const totals = new Map<CostCategory, number>();
  for (const e of entries) {
    totals.set(e.category, (totals.get(e.category) ?? 0) + e.amountPesewas);
  }

  const total = totalCost(entries);

  return [...totals.entries()]
    .map(([category, amount]) => ({
      category,
      label: CATEGORY_LABELS[category],
      pesewas: amount,
      sharePct: total > 0 ? (amount / total) * 100 : null,
    }))
    .sort((a, b) => b.pesewas - a.pesewas);
}

/**
 * What each SURVIVING bird has cost.
 *
 * FORMULA: totalCost ÷ birdsAlive
 *
 * The denominator is the birds still alive, not the birds placed. See the note
 * at the top of this file: the money spent on birds that died is real money, and
 * loading it onto the survivors is what makes this figure comparable with the
 * price a pullet will actually sell for.
 *
 * Returns null rather than Infinity when the flock is empty — a cost per bird
 * with no birds is not a very large number, it is not a number.
 */
export function costPerBird(total: number, birdsAlive: number): number | null {
  if (!Number.isFinite(total) || !Number.isFinite(birdsAlive) || birdsAlive <= 0) return null;
  return Math.round(total / birdsAlive);
}

/**
 * What each bird would have cost had none died — the comparison figure.
 *
 * FORMULA: totalCost ÷ birdsPlaced
 *
 * Shown BESIDE cost per surviving bird, never instead of it. The gap between
 * the two is the price of the mortality, stated in cedis, which is a far more
 * useful thing to look at than a mortality percentage on its own.
 */
export function costPerBirdPlaced(total: number, birdsPlaced: number): number | null {
  if (!Number.isFinite(total) || !Number.isFinite(birdsPlaced) || birdsPlaced <= 0) return null;
  return Math.round(total / birdsPlaced);
}

/**
 * What the mortality cost, per surviving bird.
 *
 * FORMULA: costPerBird(alive) − costPerBirdPlaced
 *
 * The number a farm can act on. "We lost 6% of the flock" is a statistic;
 * "every pullet we still have costs GHS 4.20 more because of it" is a decision.
 */
export function mortalityCostPerBird(
  total: number,
  birdsPlaced: number,
  birdsAlive: number,
): number | null {
  const alive = costPerBird(total, birdsAlive);
  const placed = costPerBirdPlaced(total, birdsPlaced);
  if (alive === null || placed === null) return null;
  return alive - placed;
}

/**
 * Cost per day, per bird — the running rate.
 *
 * FORMULA: totalCost ÷ birdsAlive ÷ daysReared
 *
 * Useful for spotting a week where something changed, and for answering "what
 * does another fortnight of rearing cost me" without a spreadsheet.
 */
export function costPerBirdPerDay(
  total: number,
  birdsAlive: number,
  daysReared: number,
): number | null {
  const perBird = costPerBird(total, birdsAlive);
  if (perBird === null || !Number.isFinite(daysReared) || daysReared <= 0) return null;
  return perBird / daysReared;
}

// ---------------------------------------------------------------------------
// THE LEDGER, AS IT READS
// ---------------------------------------------------------------------------

export interface RunningEntry<T extends CostEntry> {
  entry: T;
  /** Everything spent up to and including this row. */
  runningPesewas: number;
}

/**
 * Cost entries in the order they happened, each with the total so far.
 *
 * OLDEST FIRST, deliberately, even though most lists in this system are newest
 * first. A running total that counts DOWN as you read is not a running total,
 * and the question this table answers — "when did this flock get expensive?" —
 * is a question about the shape of a line, which only reads forwards.
 *
 * Reversals are ordinary rows with negative amounts. They appear in place and
 * pull the running total back down, which is exactly what a person checking the
 * figures against their receipts needs to see.
 */
export function runningTotals<T extends CostEntry>(entries: T[]): RunningEntry<T>[] {
  const ordered = [...entries].sort(
    (a, b) => startOfDay(a.incurredOn) - startOfDay(b.incurredOn),
  );

  const result: RunningEntry<T>[] = [];
  let running = 0;
  for (const entry of ordered) {
    running += entry.amountPesewas;
    result.push({ entry, runningPesewas: running });
  }
  return result;
}

/**
 * The day money first went out, and the day it last did.
 *
 * Used to say how long a flock has been accumulating cost, which is what turns
 * a total into a rate. Null when nothing has been recorded.
 */
export function costSpan(entries: CostEntry[]): { first: Date; last: Date } | null {
  if (entries.length === 0) return null;
  const times = entries.map((e) => e.incurredOn.getTime());
  return { first: new Date(Math.min(...times)), last: new Date(Math.max(...times)) };
}

// ---------------------------------------------------------------------------
// POINT OF LAY
// ---------------------------------------------------------------------------

export interface PolCost {
  /** Everything spent from placement to the day lay began. */
  rearingCostPesewas: number;
  /** Pullets alive on that day. */
  pulletsAtPol: number;
  /** THE number: what one point-of-lay pullet cost to produce. */
  costPerPulletPesewas: number | null;
  /** The day lay began, from the flock's own stage history. */
  polDate: Date;
  ageDaysAtPol: number;
}

/**
 * The cost basis a flock carries into lay.
 *
 * FORMULA
 *   rearingCost   = every cost entry incurred on or before the day lay began
 *   costPerPullet = rearingCost ÷ pullets alive on that day
 *
 * WHY THIS FIGURE AND NOT ANY OTHER
 *   Rearing a layer is five months of pure expenditure with nothing coming back.
 *   Cost per point-of-lay pullet is the line that separates that investment from
 *   the trading that follows: everything before it is the cost of building the
 *   asset, everything after is the cost of running it. Without the split, the
 *   first months of egg sales look catastrophically unprofitable and the last
 *   months look better than they are.
 *
 *   It is also the number to compare against buying pullets ready-to-lay. That
 *   comparison is the whole case for rearing from day-old, and it cannot be made
 *   without this figure.
 *
 * The date comes from the flock's OWN stage history, not from a standard age —
 * a flock that came into lay at 19 weeks and one that took 22 did not cost the
 * same, and pretending both reached it on schedule would erase the difference.
 */
export function polCost(
  entries: CostEntry[],
  polDate: Date,
  pulletsAtPol: number,
  ageDaysAtPol: number,
): PolCost {
  const rearingCostPesewas = costUpTo(entries, polDate);
  return {
    rearingCostPesewas,
    pulletsAtPol,
    costPerPulletPesewas: costPerBird(rearingCostPesewas, pulletsAtPol),
    polDate,
    ageDaysAtPol,
  };
}

/**
 * How the cost of a pullet compares with buying one ready to lay.
 *
 * Returns the difference in pesewas — negative means rearing was cheaper.
 * Returns null when no market price has been supplied, because there is no
 * default here worth having: the price of a point-of-lay pullet in Ashanti moves
 * with the season and the supplier, and a stale figure baked into software would
 * be worse than an honest blank.
 */
export function versusBoughtPullet(
  costPerPulletPesewas: number | null,
  marketPricePesewas: number | null,
): number | null {
  if (costPerPulletPesewas === null || marketPricePesewas === null) return null;
  return costPerPulletPesewas - marketPricePesewas;
}

// ---------------------------------------------------------------------------
// THE POINT OF LAY ITSELF
// ---------------------------------------------------------------------------

export interface StageChange {
  toStageId: string | null;
  occurredOn: Date;
  ageDays: number | null;
}

export interface ProductionStart {
  occurredOn: Date;
  ageDays: number | null;
}

/**
 * The day this group started producing, from its OWN history.
 *
 * Takes the ids of the stages the production type marks as its production
 * start, so nothing here knows what a laying hen is — see
 * LifecycleStage.isProductionStart.
 *
 * THE EARLIEST such change wins, not the latest. A flock moved into lay, back
 * out during a moult and into lay again has come into lay once; the second
 * transition is a return, and dating the rearing investment from it would erase
 * the months in between.
 *
 * Returns null when it has not happened — a flock still growing, or a
 * production type that has no such stage at all.
 */
export function productionStartFrom(
  changes: StageChange[],
  productionStartStageIds: string[],
): ProductionStart | null {
  if (productionStartStageIds.length === 0) return null;
  const ids = new Set(productionStartStageIds);

  const matching = changes
    .filter((c) => c.toStageId !== null && ids.has(c.toStageId))
    .sort((a, b) => a.occurredOn.getTime() - b.occurredOn.getTime());

  const first = matching[0];
  return first ? { occurredOn: first.occurredOn, ageDays: first.ageDays } : null;
}

// ---------------------------------------------------------------------------
// HOW OLD IS THE PRICE
// ---------------------------------------------------------------------------

/**
 * A pullet quote older than this is reported with its age attached.
 *
 * A quarter, because that is roughly how long a quoted pullet price in Ghana
 * stays useful — feed costs move, and the dry season and the harmattan both
 * shift what hatcheries charge. The figure is still SHOWN when it is older than
 * this; it is just shown with its date, so nobody mistakes last year's price for
 * this morning's.
 */
export const PRICE_STALE_AFTER_DAYS = 90;

export function priceAgeDays(quotedOn: Date, asOf: Date = new Date()): number {
  return Math.max(0, Math.round((startOfDay(asOf) - startOfDay(quotedOn)) / 86_400_000));
}

export function priceIsStale(quotedOn: Date, asOf: Date = new Date()): boolean {
  return priceAgeDays(quotedOn, asOf) > PRICE_STALE_AFTER_DAYS;
}

export type RearOrBuy = 'REARING_CHEAPER' | 'BUYING_CHEAPER' | 'THE_SAME';

export interface Comparison {
  /** Reared cost − market price. Negative means rearing won. */
  differencePesewas: number;
  verdict: RearOrBuy;
  /** The difference as a percentage of the market price. */
  pctOfMarket: number | null;
}

/**
 * The rear-or-buy answer, for one flock.
 *
 * FORMULA: difference = costPerPullet − marketPrice
 *
 * Deliberately not softened into a "score" or a verdict on the farm. It answers
 * one narrow question — did rearing THIS flock beat buying pullets at THAT
 * price — and the answer belongs beside both figures so the person can see what
 * it is made of.
 */
export function rearOrBuy(
  costPerPulletPesewas: number | null,
  marketPricePesewas: number | null,
): Comparison | null {
  const difference = versusBoughtPullet(costPerPulletPesewas, marketPricePesewas);
  if (difference === null || marketPricePesewas === null) return null;

  return {
    differencePesewas: difference,
    verdict:
      difference < 0 ? 'REARING_CHEAPER' : difference > 0 ? 'BUYING_CHEAPER' : 'THE_SAME',
    pctOfMarket: marketPricePesewas === 0 ? null : (difference / marketPricePesewas) * 100,
  };
}

/**
 * What the comparison means for the NEXT flock, in one sentence.
 *
 * Scaled to the flock, because a difference of GHS 4 a bird reads as small and
 * "GHS 3,760 across the flock" does not. That multiplication is the whole point
 * of putting the figure on a screen rather than in a spreadsheet.
 */
export function rearOrBuySentence(comparison: Comparison, pullets: number): string {
  const perBird = Math.abs(comparison.differencePesewas);
  const across = perBird * Math.max(0, pullets);

  if (comparison.verdict === 'THE_SAME') {
    return 'Rearing cost exactly what buying would have. Either route is the same money.';
  }

  const cheaper = comparison.verdict === 'REARING_CHEAPER';
  return (
    `${cheaper ? 'Rearing' : 'Buying'} was cheaper by ` +
    `${formatPesewas(perBird)} a bird — ${formatPesewas(across)} across ${pullets.toLocaleString('en-GH')} pullets. ` +
    (cheaper
      ? 'That is what the five months of work were worth on this flock.'
      : 'On these numbers the five months of rearing lost money against simply buying in.')
  );
}

/** Cedis with two decimals, for embedding in a sentence. */
function formatPesewas(amount: number): string {
  return `GHS ${(amount / 100).toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ---------------------------------------------------------------------------
// COMPLETENESS
// ---------------------------------------------------------------------------

/**
 * Which cost categories have nothing in them.
 *
 * A costing screen that reports GHS 48,000 without mentioning that labour and
 * utilities were never entered gives a confident answer to the wrong question.
 * This is what lets the screen say "so far as anything has been recorded",
 * naming exactly what has not.
 *
 * Chicks and feed are not on this list — a flock with neither is a flock nobody
 * has started recording, and that is already obvious.
 */
export const OFTEN_FORGOTTEN: readonly CostCategory[] = [
  'LABOUR',
  'UTILITIES',
  'TRANSPORT',
];

export function missingCategories(entries: CostEntry[]): CostCategory[] {
  const present = new Set(entries.map((e) => e.category));
  return OFTEN_FORGOTTEN.filter((c) => !present.has(c));
}

/** A sentence naming what has not been recorded, or null when nothing is missing. */
export function completenessNote(entries: CostEntry[]): string | null {
  const missing = missingCategories(entries);
  if (missing.length === 0) return null;

  const names = missing.map((c) => CATEGORY_LABELS[c].toLowerCase());
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  return `No ${list} cost has been recorded, so this total is lower than the real one.`;
}

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
