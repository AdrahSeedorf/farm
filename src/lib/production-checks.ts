import type { Warning } from '@/lib/warnings';
import { henDayProductionPct } from '@/lib/metrics';
import { rejectedOf, totalOf, type Grade, type OutputLine } from '@/lib/production';

/**
 * Plausibility checks for a collection — ADRAH Farms
 *
 * THE RULE, AS EVERYWHERE ELSE: WARN, NEVER BLOCK.
 *
 * The morning production halves is the morning the record matters most, and it
 * is exactly the entry a strict validator would refuse. Every check here returns
 * a message, the person sees it, confirms, and the figure saves as they typed
 * it. What was flagged and accepted is stored on the record, so a run of odd
 * days can be read back later.
 *
 * These look for signs the ENTRY is wrong — a count larger than the flock, a
 * collection graded twice, a number that reads like crates rather than eggs.
 * Where they mention water or lighting they are repeating what any farmhand
 * would check first; the system holds no clinical opinion and offers no
 * diagnosis.
 *
 * Thresholds are arguments, not constants. They come from the production type's
 * configured standards.
 */

export interface ProductionThresholds {
  /**
   * Hen-day production above this is flagged as extraordinary.
   *
   * Above 100 is impossible — a hen lays at most one egg a day — and is checked
   * separately. Between the ceiling and 100 is merely rare, and worth a second
   * look at whether an earlier collection has been entered twice.
   */
  henDayCeilingPct: number;
  /** A fall of this much against yesterday's total is flagged. */
  dayDropPct: number;
  /** Cracked, dirty and floor eggs above this share of the day are flagged. */
  rejectRatePct: number;
  /** Production this many points below the breed's published curve is flagged. */
  standardShortfallPoints: number;
}

/**
 * Defaults, used until a production type has configured standards.
 *
 * Deliberately wide. A warning that fires every morning is a warning people
 * learn to click past, and then the one that mattered goes past with it.
 */
export const DEFAULT_PRODUCTION_THRESHOLDS: ProductionThresholds = {
  henDayCeilingPct: 98,
  dayDropPct: 20,
  rejectRatePct: 5,
  standardShortfallPoints: 10,
};

export interface CollectionCheckInput {
  /** Birds alive in the group, from the ledger. */
  birdsAlive: number;
  ageDays: number;
  /** This collection's count. */
  quantity: number;
  /** What earlier collections have already recorded for the same day. */
  earlierToday: number;
  /** The graded breakdown, when grading was entered alongside the collection. */
  lines: OutputLine[];
  grades: Grade[];
  /** What was counted in the house, when that is a separate figure. */
  countedQuantity: number | null;
  /** Has this group passed the stage its production type calls production start? */
  productionStarted: boolean;
  /** The configured expectation of when lay begins. Null when none is set. */
  pointOfLayAgeDays: number | null;
  /** Yesterday's whole-day total, when there is one. */
  previousDayTotal: number | null;
  /** The breed's published hen-day figure for this age, when a curve is loaded. */
  standardHenDayPct: number | null;
  /** The date this group's eggs may next be sold, when a withdrawal is running. */
  eggsClearOn: Date | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function checkCollection(
  input: CollectionCheckInput,
  thresholds: ProductionThresholds = DEFAULT_PRODUCTION_THRESHOLDS,
): Warning[] {
  const warnings: Warning[] = [];
  const { birdsAlive, quantity, earlierToday, previousDayTotal } = input;
  const dayTotal = earlierToday + quantity;

  // --- Impossible, rather than merely unusual ------------------------------
  //
  // A hen lays at most one egg a day. More eggs than birds is not a remarkable
  // day, it is a wrong number — most often crates typed where eggs were asked
  // for, or a collection entered against the wrong house.
  if (birdsAlive > 0 && dayTotal > birdsAlive) {
    warnings.push({
      field: 'quantity',
      message:
        `${dayTotal.toLocaleString('en-GH')} today from ${birdsAlive.toLocaleString('en-GH')} birds. ` +
        `A bird lays at most one egg a day, so this cannot be right as counted — ` +
        `check whether this is crates rather than eggs, or belongs to another house.`,
    });
  } else if (birdsAlive > 0) {
    // Opening and closing are the same figure here, because at the moment
    // someone is typing a collection the only population that exists is the one
    // standing now. The flock's production screen computes hen-day properly,
    // from the day's own ledger, once the day is over.
    const henDay = henDayProductionPct(dayTotal, birdsAlive, birdsAlive);
    if (henDay !== null && henDay > thresholds.henDayCeilingPct) {
      warnings.push({
        field: 'quantity',
        message:
          `That puts today at ${round1(henDay)}% lay, which is extraordinary rather than ` +
          `impossible. Check no earlier collection has been entered twice.`,
      });
    }
  }

  // --- Eggs where none were expected yet -----------------------------------
  //
  // Not an error. A flock can come into lay early, and when it does the record
  // should say so — that date is what the whole rearing cost is divided at.
  if (
    quantity > 0 &&
    input.pointOfLayAgeDays !== null &&
    input.ageDays < input.pointOfLayAgeDays
  ) {
    warnings.push({
      field: 'quantity',
      message:
        `Day ${input.ageDays} is earlier than the day ${input.pointOfLayAgeDays} you have ` +
        `configured for the start of lay. If the flock really has started, record the ` +
        `stage change on the flock so the rearing cost is drawn at the right day.`,
    });
  }

  // The flock is laying and the stage still says otherwise. Worth saying,
  // because `flock-costing` splits rearing from production at that stage change
  // and cannot do it from egg records alone.
  if (
    quantity > 0 &&
    !input.productionStarted &&
    input.pointOfLayAgeDays !== null &&
    input.ageDays >= input.pointOfLayAgeDays
  ) {
    warnings.push({
      field: 'quantity',
      message:
        'This flock is producing but has not been moved into lay on its stage record. ' +
        'Until it is, the cost per point-of-lay pullet cannot be worked out.',
    });
  }

  // --- Nothing at all, from a flock that should be laying -------------------
  if (dayTotal === 0 && input.productionStarted && birdsAlive > 0) {
    warnings.push({
      field: 'quantity',
      message:
        'No eggs recorded for a flock in lay. If that is what happened it is worth ' +
        'walking the house now; if the collection simply has not been counted yet, ' +
        'leave the entry until it has.',
    });
  }

  // --- A drop against yesterday --------------------------------------------
  //
  // Production falls before anything else looks wrong. Recorded on the day it
  // starts, a fall is a question; noticed a week later it is a post-mortem.
  if (previousDayTotal !== null && previousDayTotal > 0 && dayTotal < previousDayTotal) {
    const dropPct = ((previousDayTotal - dayTotal) / previousDayTotal) * 100;
    if (dropPct >= thresholds.dayDropPct) {
      warnings.push({
        field: 'quantity',
        message:
          `Production is down ${Math.round(dropPct)}% on yesterday ` +
          `(${previousDayTotal.toLocaleString('en-GH')} → ${dayTotal.toLocaleString('en-GH')}). ` +
          `If every collection for today has been entered, check the water, the light hours ` +
          `and the house before anything else.`,
      });
    }
  }

  // --- How it graded --------------------------------------------------------
  const graded = totalOf(input.lines);
  if (graded > 0) {
    const rejected = rejectedOf(input.lines, input.grades);
    const rejectPct = (rejected / graded) * 100;
    if (rejectPct > thresholds.rejectRatePct) {
      warnings.push({
        field: 'lines',
        message:
          `${round1(rejectPct)}% of these graded as unsaleable (${rejected.toLocaleString('en-GH')} of ` +
          `${graded.toLocaleString('en-GH')}). Cracks usually come from collecting less often, ` +
          `from the trays, or from too few nest boxes.`,
      });
    }
  }

  // --- The house count against the grading bench ---------------------------
  if (input.countedQuantity !== null && graded > 0) {
    const difference = graded - input.countedQuantity;
    if (difference < 0) {
      warnings.push({
        field: 'lines',
        message:
          `${Math.abs(difference).toLocaleString('en-GH')} fewer graded than were counted in the ` +
          `house (${input.countedQuantity.toLocaleString('en-GH')} counted, ${graded.toLocaleString('en-GH')} graded). ` +
          `Both figures are kept — but if they were not broken on the way, one of the counts is wrong.`,
      });
    } else if (difference > 0) {
      warnings.push({
        field: 'lines',
        message:
          `${difference.toLocaleString('en-GH')} more graded than were counted in the house ` +
          `(${input.countedQuantity.toLocaleString('en-GH')} counted, ${graded.toLocaleString('en-GH')} graded). ` +
          `Check whether another collection has been graded with this one.`,
      });
    }
  }

  // --- Against the breed's published curve ---------------------------------
  //
  // Only when a curve has been loaded for the breed. No curve, no comparison —
  // the system does not invent a target to judge a flock against.
  if (input.standardHenDayPct !== null && birdsAlive > 0 && dayTotal > 0) {
    const henDay = henDayProductionPct(dayTotal, birdsAlive, birdsAlive);
    if (henDay !== null) {
      const behind = input.standardHenDayPct - henDay;
      if (behind >= thresholds.standardShortfallPoints) {
        warnings.push({
          field: 'quantity',
          message:
            `${round1(henDay)}% lay against the ${round1(input.standardHenDayPct)}% the breed guide ` +
            `gives for day ${input.ageDays} — ${round1(behind)} points behind.`,
        });
      }
    }
  }

  // --- Withdrawal -----------------------------------------------------------
  //
  // NOT A REFUSAL. Eggs laid during a withdrawal period exist and must be
  // recorded; hen-day production does not pause because a flock was treated.
  // What must not happen is those eggs reaching a customer, and that is stopped
  // where it belongs — at the point they would enter saleable stock.
  if (input.eggsClearOn && quantity > 0) {
    warnings.push({
      field: 'disposition',
      message:
        `This flock is under an egg withdrawal until ${input.eggsClearOn.toISOString().slice(0, 10)}. ` +
        `Record what was collected — it happened — but these eggs cannot be sold, and the ` +
        `system will not let them into saleable stock before that date.`,
    });
  }

  return warnings;
}

/** Read the thresholds out of a production type's configured standards. */
export function productionThresholdsFrom(standards: unknown): ProductionThresholds {
  if (!standards || typeof standards !== 'object') return DEFAULT_PRODUCTION_THRESHOLDS;
  const s = standards as Record<string, unknown>;
  const num = (key: string, fallback: number) =>
    typeof s[key] === 'number' && Number.isFinite(s[key]) ? (s[key] as number) : fallback;

  return {
    henDayCeilingPct: num('henDayCeilingPct', DEFAULT_PRODUCTION_THRESHOLDS.henDayCeilingPct),
    dayDropPct: num('eggDropAlertPctDaily', DEFAULT_PRODUCTION_THRESHOLDS.dayDropPct),
    rejectRatePct: num('rejectRateAlertPct', DEFAULT_PRODUCTION_THRESHOLDS.rejectRatePct),
    standardShortfallPoints: num(
      'standardShortfallAlertPoints',
      DEFAULT_PRODUCTION_THRESHOLDS.standardShortfallPoints,
    ),
  };
}

/**
 * The configured expectation of when lay begins, if there is one.
 *
 * Read from `pointOfLayAgeDays` in the production type's standards — the same
 * figure the seed writes. Null when nothing has been configured, and then the
 * checks that depend on it simply do not run rather than assuming a number.
 */
export function pointOfLayAgeFrom(standards: unknown): number | null {
  if (!standards || typeof standards !== 'object') return null;
  const value = (standards as Record<string, unknown>).pointOfLayAgeDays;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
