import type { StockMovementType } from '@/lib/stock-ledger';
import { fromBase } from '@/lib/uom';

/**
 * Days of cover — ADRAH Farms
 *
 * "How long until we run out" — the only stock question a farm actually asks at
 * six in the morning. Pure arithmetic, no database.
 *
 * THIS IS AN EXTRAPOLATION, NOT A FORECAST, and the difference is stated on
 * screen rather than hidden behind a confident number. It says what recent use
 * implies if nothing changes. Nothing here models a growth curve, a season or a
 * price — introducing a predictive model would mean a farm ordering feed on the
 * strength of arithmetic it cannot check, which is exactly the wrong trade for a
 * business where running out is a real cost.
 */

/**
 * Movements that count as USE.
 *
 * Damage and expiry are excluded deliberately. They are losses, not consumption:
 * a month with a flooded store would inflate the daily rate and then report a
 * comfortable amount of feed as nearly exhausted. They matter — they are just a
 * different question, answered by the waste figures.
 */
export const USAGE_MOVEMENTS: readonly StockMovementType[] = ['ISSUE', 'CONSUMPTION', 'SALE'];

/**
 * How much lead time an order needs, in days.
 *
 * A DEFAULT, not a rule. A farm whose supplier delivers next day needs three
 * days of cover; one ordering from Accra needs ten, and the same 40 kg of feed
 * is comfortable for the first and an emergency for the second. It becomes an
 * organisation setting when procurement lands; until then it is a parameter with
 * a documented value rather than a number buried in a comparison.
 */
export const DEFAULT_LEAD_TIME_DAYS = 7;

/**
 * How far back to look when working out the rate of use.
 *
 * SEVEN DAYS, not thirty. A growing flock's feed intake climbs steeply — a
 * day-old chick eats around a tenth of what a point-of-lay pullet does — so a
 * month-long average of a growing flock systematically understates tomorrow and
 * reports cover that does not exist. A week tracks the ramp closely enough to be
 * useful and is short enough that a farm can check it by hand.
 */
export const DEFAULT_WINDOW_DAYS = 7;

/**
 * The fewest days of history worth averaging.
 *
 * Below this, "we used 400 kg yesterday" becomes "400 kg a day", and a store
 * holding three weeks of feed is reported as having one. Too little history is
 * reported as no answer rather than a confident wrong one.
 */
export const MINIMUM_OBSERVED_DAYS = 3;

export interface UsageRate {
  /** Base units used per day across the observed window. */
  perDay: number;
  /** How many days the average actually covers — never more than the window. */
  observedDays: number;
  totalUsed: number;
}

const DAY_MS = 86_400_000;

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole days from `from` to `to`, inclusive of both ends. */
export function daysInclusive(from: Date, to: Date): number {
  return Math.floor((startOfDay(to) - startOfDay(from)) / DAY_MS) + 1;
}

/**
 * The rate at which an item is being used.
 *
 * FORMULA
 *   perDay = totalUsedInWindow ÷ observedDays
 *   observedDays = min(windowDays, days since the item's first movement)
 *
 * The denominator is CALENDAR days, not days on which something was issued. A
 * farm that feeds from the store five mornings a week still has to get through
 * Sunday, and dividing by three "active" days would report a rate nobody is
 * ever going to use.
 *
 * Returns null when there is not enough history to divide by — see
 * MINIMUM_OBSERVED_DAYS. A rate of ZERO is a real answer and is returned as
 * one: it means the item is sitting there unused, which is different from not
 * knowing.
 */
export function usageRate(
  totalUsedInWindow: number,
  firstMovementOn: Date | null,
  asOf: Date,
  windowDays = DEFAULT_WINDOW_DAYS,
  minimumObservedDays = MINIMUM_OBSERVED_DAYS,
): UsageRate | null {
  if (!firstMovementOn) return null;

  const sinceFirst = daysInclusive(firstMovementOn, asOf);
  if (sinceFirst <= 0) return null;

  const observedDays = Math.min(windowDays, sinceFirst);
  if (observedDays < minimumObservedDays) return null;

  const totalUsed = Math.max(0, totalUsedInWindow);
  return {
    perDay: totalUsed / observedDays,
    observedDays,
    totalUsed,
  };
}

/** The date the stock runs out at the current rate. Null when it does not. */
export function runsOutOn(asOf: Date, days: number | null): Date | null {
  if (days === null || !Number.isFinite(days) || days < 0) return null;
  return new Date(startOfDay(asOf) + Math.floor(days) * DAY_MS);
}

export type CoverUrgency = 'OUT' | 'CRITICAL' | 'LOW' | 'OK' | 'UNKNOWN';

/**
 * How worried to be, measured against how long an order takes to arrive.
 *
 * WHY LEAD TIME AND NOT A FIXED NUMBER OF DAYS
 *   "Four days of feed" is not information until you know how long feed takes to
 *   arrive. Four days is comfortable with a next-day supplier and an emergency
 *   with a week-long one, and a threshold that ignores that is a threshold that
 *   cries wolf on one farm and stays silent on the other.
 *
 *   CRITICAL means: you will run out before a delivery ordered today can arrive.
 *   LOW means: you are inside the window where ordering has to start.
 */
export function coverUrgency(
  days: number | null,
  leadTimeDays = DEFAULT_LEAD_TIME_DAYS,
): CoverUrgency {
  if (days === null || !Number.isFinite(days)) return 'UNKNOWN';
  if (days <= 0) return 'OUT';
  if (days < leadTimeDays) return 'CRITICAL';
  if (days < leadTimeDays * 2) return 'LOW';
  return 'OK';
}

/**
 * A short sentence a storekeeper can act on.
 *
 * Written out here rather than assembled in the page so the wording is testable
 * and identical everywhere the figure appears.
 */
export function coverSentence(
  days: number | null,
  rate: UsageRate | null,
  leadTimeDays = DEFAULT_LEAD_TIME_DAYS,
): string {
  if (rate === null) return 'Not enough history yet to say how long this will last.';
  if (rate.perDay === 0) return 'Nothing issued in the last week, so there is no rate to project.';
  if (days === null) return 'No stock on hand.';

  const rounded = Math.round(days * 10) / 10;
  const basis = `at the last ${rate.observedDays} days’ rate`;

  if (days <= 0) return `Out of stock ${basis}.`;
  if (days < leadTimeDays) {
    return `About ${rounded} days left ${basis} — less than the ${leadTimeDays} days a delivery takes.`;
  }
  return `About ${rounded} days left ${basis}.`;
}

// ---------------------------------------------------------------------------
// WHOSE LEAD TIME?
// ---------------------------------------------------------------------------

export interface SupplierLeadTime {
  id: string;
  name: string;
  /** The figure actually in force for this supplier — its own, or the farm's. */
  leadTimeDays: number;
  /** Item categories this supplier sells. Empty means nobody has said. */
  supplies: string[];
}

export interface LeadTimeBasis {
  days: number;
  /** Null when the farm-wide figure is standing in. */
  supplierName: string | null;
}

/**
 * How quickly THIS item could actually be here.
 *
 * The farm-wide figure treats a feed mill two weeks away and a hardware shop in
 * the next street as the same thing. That single number then decides whether
 * four days of feed reads as comfortable or as an emergency, so it is worth
 * getting closer to the truth than one average for everything.
 *
 * THE FASTEST SUPPLIER WHO ACTUALLY SELLS IT, and the answer says whose figure
 * it is.
 *
 *   Fastest, not slowest or average, because the question this feeds is "will I
 *   run out before a delivery ordered today could arrive?" — and if somebody can
 *   get it here in three days, then three days is the honest answer. The person
 *   may well prefer the cheaper supplier who takes a fortnight; that is their
 *   call to make, and they can only make it if the screen says which supplier
 *   the figure came from. So it does.
 *
 * Falls back to the farm's own figure when no supplier is recorded as selling
 * this category — which, on a farm that has only just started writing suppliers
 * down, is most of them.
 */
export function leadTimeForCategory(
  category: string,
  suppliers: SupplierLeadTime[],
  farmLeadTimeDays: number,
): LeadTimeBasis {
  const able = suppliers.filter((s) => s.supplies.includes(category));
  if (able.length === 0) return { days: farmLeadTimeDays, supplierName: null };

  const fastest = able.reduce((best, s) => (s.leadTimeDays < best.leadTimeDays ? s : best));
  return { days: fastest.leadTimeDays, supplierName: fastest.name };
}

/** Where the lead time behind an urgency figure came from, in words. */
export function leadTimeBasisSentence(basis: LeadTimeBasis): string {
  const days = `${basis.days} day${basis.days === 1 ? '' : 's'}`;
  return basis.supplierName === null
    ? `Measured against the farm’s own ${days} — no supplier is recorded as selling this.`
    : `Measured against ${basis.supplierName}, the quickest supplier recorded for this, at ${days}.`;
}

// ---------------------------------------------------------------------------
// WHAT IS ALREADY ON ITS WAY
// ---------------------------------------------------------------------------

export interface Incoming {
  /** Outstanding quantity across every open order, in the item's BASE unit. */
  quantityBase: number;
  /** The earliest date any of it was promised for. Null when none was agreed. */
  earliestExpectedOn: Date | null;
  /** How many orders it is spread across. */
  orderCount: number;
  /** The reference to quote when chasing — the earliest, or the only, one. */
  orderNumber: string | null;
  /** True when at least one of those orders is already past its agreed date. */
  anyLate: boolean;
}

/**
 * What is on order but not yet delivered.
 *
 * NEVER ADDED TO WHAT IS ON HAND. An order is an expectation and stock on hand
 * is a fact, and a store that counts feed still sitting at the mill as feed it
 * has is a store that runs out while its own screen says it is comfortable.
 *
 * It is reported ALONGSIDE the cover figure instead, because the two together
 * are what somebody actually acts on: three days of feed with twenty bags due
 * tomorrow is a different morning from three days of feed with nothing coming.
 */
export function incomingSentence(incoming: Incoming | null, unitKey: string): string {
  if (incoming === null || incoming.quantityBase <= 0) {
    return 'Nothing on order.';
  }

  // THE CONVERSION HAPPENS HERE, not at the call site. `quantityBase` is in the
  // dimension's base unit and `unitKey` is what the item is counted in — a
  // thousand kilograms is twenty bags — and a caller that formatted the base
  // figure with the display label would print "1000 bag 50kg" for twenty bags.
  // Which is exactly what the first version of this line did.
  const amount = `${round(fromBase(incoming.quantityBase, unitKey))} ${unitKey.replace(/_/g, ' ')}`;
  const where =
    incoming.orderCount > 1
      ? `across ${incoming.orderCount} orders`
      : (incoming.orderNumber ?? 'on order');

  if (incoming.anyLate) {
    return `${amount} ${where} — already past the date agreed. Worth a phone call.`;
  }
  if (incoming.earliestExpectedOn === null) {
    return `${amount} ${where}, with no delivery date agreed.`;
  }
  return `${amount} ${where}, due ${incoming.earliestExpectedOn.toISOString().slice(0, 10)}.`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
