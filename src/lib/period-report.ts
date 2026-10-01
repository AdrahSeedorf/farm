import { type Pesewas, formatGHS, ZERO } from '@/lib/money';
import { round, henDayProductionPct, saleableRatePct, averageBirdsAlive } from '@/lib/metrics';

/**
 * The period report — ADRAH Farms
 *
 * WHAT HAPPENED BETWEEN TWO DATES, read from the ledgers and checked against
 * itself.
 *
 * THE RECONCILIATION IS THE POINT OF THIS SCREEN — AND IT CHECKS THE ONE THING
 * THAT CAN ACTUALLY DISAGREE.
 *
 *   The first version of this compared what went into the store against what
 *   came out of it and the change in what the store holds. Those three figures
 *   are all the stock ledger, so they agreed by construction: it was a check that
 *   could never fail, which is worse than no check at all, because somebody would
 *   have trusted it.
 *
 *   What CAN disagree is the house and the store:
 *
 *       eggs counted in the houses, in grades this farm holds as stock
 *     − eggs that actually entered the store
 *     = eggs that were counted and never became stock
 *
 *   Those are written by different steps and can come apart — a collection saved
 *   while no store was flagged to receive produce, a grade unlinked from its item
 *   halfway through a week, a correction applied to one and not the other.
 *
 *   WHAT THIS STILL CANNOT CHECK is the shelf. Every figure here is the records
 *   agreeing with the records. Only a stock count compares them to reality, and
 *   `stockTakeNote` says on the screen whether one has happened and when.
 *   Saying so is the difference between a report and a reassurance.
 *
 * EVERY FIGURE SAYS WHERE IT CAME FROM. A number on a report with no stated
 * basis is a number somebody will eventually defend in an argument they cannot
 * win. `basisOf` below is not decoration.
 *
 * NOTHING HERE IS MONEY RECEIVED. Sales are what was agreed on confirmed orders;
 * payments are not recorded anywhere yet. Calling any of this "revenue" or
 * "income" would put a figure on a screen a farm would plan around.
 */

// ---------------------------------------------------------------------------
// THE PERIOD
// ---------------------------------------------------------------------------

export const PERIODS = ['THIS_WEEK', 'LAST_WEEK', 'THIS_MONTH', 'LAST_MONTH', 'CUSTOM'] as const;
export type PeriodKey = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  THIS_WEEK: 'This week',
  LAST_WEEK: 'Last week',
  THIS_MONTH: 'This month',
  LAST_MONTH: 'Last month',
  CUSTOM: 'Choose the dates',
};

export interface Period {
  key: PeriodKey;
  /** Inclusive, at UTC midnight. */
  from: Date;
  /** Inclusive, at UTC midnight. */
  to: Date;
}

const DAY = 86_400_000;
const utcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * WEEKS RUN MONDAY TO SUNDAY.
 *
 * Not a preference: a farm week in Ghana is discussed as "this week" meaning the
 * one that started on Monday, and a report that quietly used Sunday would put
 * one day's eggs in the wrong week every single time.
 */
export function startOfWeek(on: Date): Date {
  const d = utcDay(on);
  const dayOfWeek = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - dayOfWeek * DAY);
}

export function periodFor(key: PeriodKey, today: Date, custom?: { from: Date; to: Date }): Period {
  const now = utcDay(today);

  if (key === 'CUSTOM' && custom) {
    // Backwards dates are somebody's typing, not an error worth refusing over.
    const [from, to] =
      custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
    return { key, from: utcDay(from), to: utcDay(to) };
  }

  if (key === 'THIS_WEEK') {
    return { key, from: startOfWeek(now), to: now };
  }
  if (key === 'LAST_WEEK') {
    const thisWeek = startOfWeek(now);
    return {
      key,
      from: new Date(thisWeek.getTime() - 7 * DAY),
      to: new Date(thisWeek.getTime() - DAY),
    };
  }
  if (key === 'LAST_MONTH') {
    const firstOfThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastOfPrevious = new Date(firstOfThis.getTime() - DAY);
    return {
      key,
      from: new Date(Date.UTC(lastOfPrevious.getUTCFullYear(), lastOfPrevious.getUTCMonth(), 1)),
      to: lastOfPrevious,
    };
  }
  // THIS_MONTH, and the fallback for a CUSTOM with no dates yet.
  return { key, from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: now };
}

export function daysIn(period: Period): number {
  return Math.round((period.to.getTime() - period.from.getTime()) / DAY) + 1;
}

export function periodSentence(period: Period): string {
  const from = period.from.toISOString().slice(0, 10);
  const to = period.to.toISOString().slice(0, 10);
  const days = daysIn(period);
  if (from === to) return `${from} — one day.`;
  return `${from} to ${to} — ${days} days.`;
}

/** A period that has not started yet holds nothing, and should say so. */
export function isInFuture(period: Period, today: Date): boolean {
  return period.from.getTime() > utcDay(today).getTime();
}

// ---------------------------------------------------------------------------
// WHAT THE LEDGERS SAID
// ---------------------------------------------------------------------------

export interface PeriodFigures {
  /** Eggs recorded as collected, all grades. From the production ledger. */
  collected: number;
  /** Of those, the grades this farm has marked as saleable. */
  saleable: number;
  /**
   * Of those, the grades that are held as stock at all.
   *
   * THE ONLY FIGURE THE STORE CAN BE CHECKED AGAINST. Cracked and floor eggs are
   * collected, counted and usually held as stock by nobody — so comparing the
   * whole collection against the store would report a gap every single day and
   * teach the farm to ignore the one that mattered.
   */
  collectedHeld: number;
  /** Base units that entered the store as produce. From the stock ledger. */
  intoStore: number;
  /** Base units that left the store as a sale. From the stock ledger. */
  outOfStore: number;
  /** Base units lost — damaged, expired. From the stock ledger. */
  wasted: number;
  /** What the store held the day before the period began, and on its last day. */
  openingStock: number;
  closingStock: number;
  /** Packs on confirmed loads, converted to base units. From the dispatch ledger. */
  dispatched: number;
  /** What those sales were AGREED at. Never "received" — payments do not exist. */
  agreedPesewas: Pesewas;
  loads: number;
  /** Birds. From the population ledger. */
  openingBirds: number;
  closingBirds: number;
  deaths: number;
  culls: number;
  /** Kilograms issued to houses. From the stock ledger. */
  feedKg: number;
  feedPesewas: Pesewas;
}

export const EMPTY_FIGURES: PeriodFigures = {
  collected: 0,
  saleable: 0,
  collectedHeld: 0,
  intoStore: 0,
  outOfStore: 0,
  wasted: 0,
  openingStock: 0,
  closingStock: 0,
  dispatched: 0,
  agreedPesewas: ZERO,
  loads: 0,
  openingBirds: 0,
  closingBirds: 0,
  deaths: 0,
  culls: 0,
  feedKg: 0,
  feedPesewas: ZERO,
};

/**
 * Where a figure came from, in words somebody can check.
 *
 * NOT DECORATION. Somebody will one day disagree with a number on this screen,
 * and the only useful answer is which rows it was added up from.
 */
export const BASIS: Record<string, string> = {
  collected: 'Added up from the collections recorded against every house, by grade.',
  saleable: 'The same collections, counting only the grades this farm has marked as saleable.',
  collectedHeld:
    'The same collections again, counting only the grades that are linked to a store item. Cracked and floor eggs usually are not.',
  intoStore: 'Produce movements into the store, from the stock ledger.',
  outOfStore: 'Sale movements out of the store, from the stock ledger.',
  wasted: 'Damage and expiry movements, from the stock ledger.',
  stock: 'Every movement of produce up to that day, added up. There is no stored total.',
  dispatched: 'Packs on loads that have not been reversed, multiplied by what one pack holds.',
  agreed: 'The prices copied onto the lines of those loads’ orders when they were written.',
  birds: 'The population ledger: placements, deaths, culls and sales, added up to that day.',
  feed: 'Feed issued to houses, from the stock ledger, priced at what the batches cost.',
};

// ---------------------------------------------------------------------------
// THE RECONCILIATION
// ---------------------------------------------------------------------------

export type ReconcileVerdict = 'AGREES' | 'DISAGREES' | 'NOTHING_TO_CHECK';

export interface Reconciliation {
  verdict: ReconcileVerdict;
  /** Counted in the houses, in grades this farm holds as stock. */
  countedInHouses: number;
  /** Actually booked into the store. */
  reachedStore: number;
  /** counted − reached. Positive means eggs were counted that never became stock. */
  gap: number;
  /** Collected in grades nobody holds as stock. Explained, not a gap. */
  notHeldAsStock: number;
  sentence: string;
}

/**
 * Did everything counted in the houses reach the store?
 *
 *   counted  = collections in grades that are linked to a store item
 *   reached  = produce movements into the store
 *   gap      = counted − reached
 *
 * A POSITIVE GAP MEANS EGGS WERE COUNTED AND NEVER BECAME STOCK. That is the
 * direction worth noticing, and it is stated in eggs rather than as a percentage,
 * because "40 eggs never reached the store" is a sentence somebody can go and
 * investigate and "99.3% accurate" is not.
 *
 * GRADES NOBODY HOLDS AS STOCK ARE NOT A GAP. Cracked and floor eggs are counted
 * and usually held by nobody; counting them here would report a difference every
 * single day and teach the farm to ignore the one that mattered. They are
 * reported separately, as the explained number they are.
 *
 * THE TOLERANCE IS ZERO. Eggs are counted in whole eggs; there is no rounding to
 * absorb, and a farm that learns to ignore a gap of one will ignore a gap of a
 * thousand.
 */
export function reconcile(figures: PeriodFigures): Reconciliation {
  const countedInHouses = round(figures.collectedHeld, 2) ?? 0;
  const reachedStore = round(figures.intoStore, 2) ?? 0;
  const gap = round(countedInHouses - reachedStore, 2) ?? 0;
  const notHeldAsStock = round(figures.collected - figures.collectedHeld, 2) ?? 0;

  if (figures.collected === 0 && reachedStore === 0) {
    return {
      verdict: 'NOTHING_TO_CHECK',
      countedInHouses,
      reachedStore,
      gap,
      notHeldAsStock,
      sentence:
        'Nothing was collected and nothing entered the store in this period, so there is nothing to check yet.',
    };
  }

  if (gap === 0) {
    return {
      verdict: 'AGREES',
      countedInHouses,
      reachedStore,
      gap,
      notHeldAsStock,
      sentence:
        'Everything counted in the houses reached the store. The collections and the store agree.',
    };
  }

  return {
    verdict: 'DISAGREES',
    countedInHouses,
    reachedStore,
    gap,
    notHeldAsStock,
    sentence:
      gap > 0
        ? `${gap} were counted in the houses and never reached the store. That usually means a collection was saved while no store was set to receive produce, or a grade was unlinked from its store item partway through.`
        : `The store received ${Math.abs(gap)} more than the houses counted. Something entered the store that no collection accounts for — check for a receipt recorded against the produce item by hand.`,
  };
}

/**
 * WHAT THIS REPORT CAN AND CANNOT TELL ANYBODY.
 *
 * Said on the screen, every time, and the wording now turns on a fact rather
 * than on an apology: has anybody actually counted the store, and how long ago?
 *
 * EVERY FIGURE ABOVE IS STILL THE RECORDS AGREEING WITH THE RECORDS. A stock
 * take is the only thing that compares them to a shelf, and its value decays —
 * a count from February says almost nothing about April. So the note reports
 * the date and lets the reader judge, instead of either claiming the figures
 * are verified or claiming nothing can be known.
 *
 * `days` is deliberately a parameter rather than read in here: this module is
 * pure, and a function that quietly asked the clock would give a different
 * answer in a test than on a screen.
 */
export function stockTakeNote(lastCountedOn: Date | null, asOf: Date): string {
  const base =
    'Everything above is the records agreeing with the records — it cannot by itself tell you whether the eggs are actually on the shelf. Only a stock count can.';

  if (!lastCountedOn) {
    return `${base} Nobody has counted a store yet.`;
  }

  const days = Math.max(
    0,
    Math.round((startOfDayUTC(asOf) - startOfDayUTC(lastCountedOn)) / 86_400_000),
  );
  const when =
    days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;

  if (days > 45) {
    return `${base} The last count was ${when}, on ${lastCountedOn
      .toISOString()
      .slice(0, 10)} — long enough that it says little about what is there now.`;
  }

  return `${base} A store was last counted ${when}, and the ledger was corrected to match what was found.`;
}

function startOfDayUTC(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// ---------------------------------------------------------------------------
// WHAT THE FIGURES MEAN
// ---------------------------------------------------------------------------

export interface DerivedFigures {
  /** Eggs per hundred birds per day, over the period. Null before any birds. */
  henDayPct: number | null;
  saleablePct: number | null;
  /** Deaths and culls as a share of the birds there at the start. */
  lossPct: number | null;
  /** Grams of feed per bird per day. */
  feedPerBirdGrams: number | null;
  /** What the feed for this period cost per egg collected. */
  feedCostPerEgg: Pesewas | null;
  /** Eggs collected but not yet sold — a real number, not a failure. */
  unsold: number;
}

/**
 * The derived figures, each from a formula stated in metrics.ts.
 *
 * FEED COST PER EGG IS NOT A COST PER EGG. It is feed only — no labour, no
 * depreciation, no share of the pullets. It is labelled that way on the screen
 * because a farm that reads it as the full cost will price below its own costs,
 * and feed is simply the part that is knowable today.
 */
export function derive(figures: PeriodFigures, days: number): DerivedFigures {
  const averageBirds = averageBirdsAlive(figures.openingBirds, figures.closingBirds);

  return {
    henDayPct:
      days > 0 && averageBirds > 0
        ? round(henDayProductionPct(figures.collected / days, figures.openingBirds, figures.closingBirds), 1)
        : null,
    saleablePct: round(saleableRatePct(figures.saleable, figures.collected), 1),
    lossPct:
      figures.openingBirds > 0
        ? round(((figures.deaths + figures.culls) / figures.openingBirds) * 100, 2)
        : null,
    feedPerBirdGrams:
      averageBirds > 0 && days > 0
        ? round((figures.feedKg * 1000) / averageBirds / days, 0)
        : null,
    feedCostPerEgg:
      figures.collected > 0
        ? (Math.round(figures.feedPesewas / figures.collected) as Pesewas)
        : null,
    unsold: round(figures.collected - figures.dispatched, 2) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// READING IT BACK
// ---------------------------------------------------------------------------

export function headline(figures: PeriodFigures, derived: DerivedFigures): string {
  if (figures.collected === 0 && figures.dispatched === 0) {
    return 'Nothing was collected and nothing went out in this period.';
  }
  const parts = [`${figures.collected} collected`];
  if (figures.dispatched > 0) parts.push(`${figures.dispatched} sold`);
  if (derived.henDayPct !== null) parts.push(`${derived.henDayPct}% hen-day`);
  return `${parts.join(' · ')}.`;
}

/**
 * What was agreed, said so it cannot be mistaken for money in hand.
 *
 * THE SAME RULE AS THE BUYER PAGE. A farm looking at a figure called "sales" will
 * treat it as takings; until payments are recorded, the only honest word is
 * "agreed".
 */
export function agreedSentence(figures: PeriodFigures): string {
  if (figures.loads === 0) return 'Nothing went out in this period.';
  return `${formatGHS(figures.agreedPesewas)} agreed across ${figures.loads} ${
    figures.loads === 1 ? 'load' : 'loads'
  }. This is what was agreed, not what has been received — payments are not recorded yet.`;
}

export function lossSentence(figures: PeriodFigures, derived: DerivedFigures): string {
  const total = figures.deaths + figures.culls;
  if (total === 0) return 'No birds were lost in this period.';
  const parts: string[] = [];
  if (figures.deaths > 0) parts.push(`${figures.deaths} died`);
  if (figures.culls > 0) parts.push(`${figures.culls} culled`);
  const share = derived.lossPct === null ? '' : ` — ${derived.lossPct}% of the birds there at the start`;
  return `${parts.join(', ')}${share}.`;
}
