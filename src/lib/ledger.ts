/**
 * Ledger rules — ADRAH Farms
 *
 * ARCHITECTURAL RULE #1: population and stock are DERIVED, never stored.
 *
 * There is no writable `population` column on AnimalGroup, and no
 * `quantityOnHand` column on Item. Both are the signed sum of an append-only
 * event ledger.
 *
 * Why this matters more than it looks:
 *   A farm system where someone can type a corrected bird count into a field
 *   will, within a few months, hold a population number that disagrees with its
 *   own mortality history and its own sales records. At that point nobody can
 *   say which is true, and every report built on top is suspect.
 *
 *   Here, a correction is a NEW event with a reason code and an author. History
 *   is never rewritten, and the current number is always reproducible from first
 *   principles.
 *
 * This module holds the pure rules. It has no database imports so it can be
 * exhaustively unit-tested, and so the sign of an event can never be decided
 * ad hoc at a call site.
 */

export type AnimalGroupEventType =
  | 'PLACEMENT'
  | 'MORTALITY'
  | 'CULL'
  | 'SALE'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'ADJUSTMENT'
  | 'STAGE_CHANGE';

/**
 * The direction each event type moves the population.
 *  +1 adds birds, -1 removes them, 0 changes nothing.
 *
 * ADJUSTMENT is 0 here because it is the one event that may go either way; its
 * caller supplies an already-signed delta. Everything else is mechanical.
 */
const EVENT_DIRECTION: Record<AnimalGroupEventType, -1 | 0 | 1> = {
  PLACEMENT: 1,
  TRANSFER_IN: 1,
  MORTALITY: -1,
  CULL: -1,
  SALE: -1,
  TRANSFER_OUT: -1,
  ADJUSTMENT: 0,
  STAGE_CHANGE: 0,
};

/** Event types that reduce the flock through death rather than sale or transfer. */
export const DEATH_EVENT_TYPES: readonly AnimalGroupEventType[] = ['MORTALITY', 'CULL'];

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/**
 * Compute the signed delta for an event. THE ONLY place a sign is decided.
 *
 * @param type      the event type
 * @param quantity  a POSITIVE count as the user entered it ("6 deaths"), except
 *                  for ADJUSTMENT where a signed value is required and expected
 */
export function deltaFor(type: AnimalGroupEventType, quantity: number): number {
  if (!Number.isInteger(quantity)) {
    throw new LedgerError(`Quantity must be a whole number of animals, received ${quantity}`);
  }

  if (type === 'STAGE_CHANGE') {
    if (quantity !== 0) {
      throw new LedgerError('STAGE_CHANGE events must not move population');
    }
    return 0;
  }

  if (type === 'ADJUSTMENT') {
    if (quantity === 0) {
      throw new LedgerError('An ADJUSTMENT of zero records nothing — omit it instead');
    }
    return quantity; // already signed, deliberately
  }

  if (quantity <= 0) {
    throw new LedgerError(
      `${type} requires a positive quantity, received ${quantity}. ` +
        `Do not encode direction in the number — the event type carries it.`,
    );
  }

  return EVENT_DIRECTION[type] * quantity;
}

export interface PopulationEvent {
  type: AnimalGroupEventType;
  delta: number;
  occurredOn: Date;
}

/**
 * Population as at the end of `asOf` (inclusive), or over all events when
 * `asOf` is omitted.
 */
export function populationAsOf(events: PopulationEvent[], asOf?: Date): number {
  const cutoff = asOf ? endOfDay(asOf) : null;
  return events.reduce((total, e) => {
    if (cutoff && e.occurredOn.getTime() > cutoff) return total;
    return total + e.delta;
  }, 0);
}

/** Opening and closing population for a single day, plus the day's movements. */
export function dayPopulation(
  events: PopulationEvent[],
  onDate: Date,
): { opening: number; closing: number; deaths: number; sold: number } {
  const dayStart = startOfDay(onDate);
  const dayEnd = endOfDay(onDate);

  let opening = 0;
  let closing = 0;
  let deaths = 0;
  let sold = 0;

  for (const e of events) {
    const t = e.occurredOn.getTime();
    if (t < dayStart) {
      opening += e.delta;
      closing += e.delta;
    } else if (t <= dayEnd) {
      closing += e.delta;
      if (DEATH_EVENT_TYPES.includes(e.type)) deaths += Math.abs(e.delta);
      if (e.type === 'SALE') sold += Math.abs(e.delta);
    }
  }

  return { opening, closing, deaths, sold };
}

/**
 * Total deaths (mortality + culls) between two dates inclusive.
 * Culls are counted here because a bird culled is a bird gone; the two are
 * reported separately elsewhere because their CAUSES are entirely different.
 */
export function deathsBetween(events: PopulationEvent[], from: Date, to: Date): number {
  const a = startOfDay(from);
  const b = endOfDay(to);
  return events
    .filter((e) => DEATH_EVENT_TYPES.includes(e.type))
    .filter((e) => e.occurredOn.getTime() >= a && e.occurredOn.getTime() <= b)
    .reduce((sum, e) => sum + Math.abs(e.delta), 0);
}

/**
 * Sanity check used by the nightly rebuild job and by the tests.
 *
 * A negative population means the ledger is internally inconsistent — more birds
 * have left than ever arrived. That is always a data-entry fault (usually a
 * mortality recorded against the wrong flock), and it must surface loudly rather
 * than quietly clamping to zero.
 */
export function assertLedgerCoherent(events: PopulationEvent[]): void {
  const sorted = [...events].sort((a, b) => a.occurredOn.getTime() - b.occurredOn.getTime());
  let running = 0;
  for (const e of sorted) {
    running += e.delta;
    if (running < 0) {
      throw new LedgerError(
        `Ledger is incoherent: population fell below zero on ` +
          `${e.occurredOn.toISOString().slice(0, 10)} after a ${e.type} event. ` +
          `An event has been recorded against the wrong group, or a placement is missing.`,
      );
    }
  }
}

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function endOfDay(d: Date): number {
  return startOfDay(d) + 86_399_999;
}
