import type { Warning } from '@/lib/warnings';
import type { OrderLine, SalesOrderState } from '@/lib/sales';

/**
 * Dispatch — ADRAH Farms
 *
 * WHAT ACTUALLY LEFT THE FARM.
 *
 * An order is a promise (see sales.ts). A dispatch is the moment produce stops
 * being the farm's and becomes somebody else's — the crates going onto a vehicle,
 * or a buyer carrying them to their own car. It is the only act in the sales side
 * that moves stock, and it is recorded separately from the order for the same
 * reason receiving is recorded separately from a purchase order: what was
 * promised and what went out are different facts, and a system that stores only
 * one of them cannot answer why the store is short.
 *
 * FULFILMENT IS DERIVED, NEVER STORED.
 *
 *   There is no `status = DELIVERED` on an order. "Delivered" is what the
 *   dispatch rows add up to, and the moment it becomes a column somebody sets, it
 *   starts disagreeing with the rows beneath it. The same rule the population,
 *   stock and attendance ledgers follow.
 *
 * PART DISPATCH IS ORDINARY, NOT AN EXCEPTION.
 *
 *   Ten crates ordered, six collected Wednesday and four on Friday is a normal
 *   week. So a dispatch carries its own quantities rather than "fulfil this
 *   order", and an order with nothing left outstanding is simply one whose
 *   dispatches add up.
 *
 * NOTHING HERE KNOWS ABOUT MONEY. A dispatch is not an invoice and not a
 * payment. See the note at the top of sales.ts.
 */

// ---------------------------------------------------------------------------
// HOW IT LEFT
// ---------------------------------------------------------------------------

export const DISPATCH_METHODS = ['COLLECTED', 'DELIVERED'] as const;
export type DispatchMethod = (typeof DISPATCH_METHODS)[number];

export const METHOD_LABELS: Record<DispatchMethod, string> = {
  COLLECTED: 'Buyer collected it',
  DELIVERED: 'The farm delivered it',
};

/** `DSP-2026-0007`. The number written on the paper that travels with the load. */
export function referenceFor(year: number, sequence: number): string {
  return `DSP-${year}-${String(sequence).padStart(4, '0')}`;
}

export function sequenceOf(reference: string, year: number): number {
  const match = new RegExp(`^DSP-${year}-(\\d{4,})$`).exec(reference);
  return match ? Number(match[1]) : 0;
}

// ---------------------------------------------------------------------------
// THE RECORD
// ---------------------------------------------------------------------------

export interface DispatchLine {
  id: string;
  salesOrderLineId: string | null;
  productId: string;
  productName: string;
  packLabel: string;
  unitsPerPack: number;
  /** Whole packs. Half a crate is a tray, and a tray is its own product. */
  quantity: number;
}

export interface Dispatch {
  id: string;
  reference: string;
  salesOrderId: string;
  orderNumber: string;
  customerName: string;
  method: DispatchMethod;
  dispatchedOn: Date;
  /**
   * Who carried it.
   *
   * FREE TEXT, AND DELIBERATELY SO. A farm's driver may be a relative with no
   * account, and on a collection the person carrying it is the buyer. Requiring
   * a user record here would mean either inventing accounts for people who will
   * never sign in, or leaving the field empty on most rows — and an empty field
   * is worse than a written name when somebody asks who took the load.
   */
  takenBy: string | null;
  vehicle: string | null;
  receivedBy: string | null;
  notes: string | null;
  lines: DispatchLine[];
  recordedByName: string | null;
  createdAt: Date;
  /**
   * REVERSED, NEVER DELETED.
   *
   * A dispatch writes to the stock ledger, so a mistyped one cannot simply be
   * removed — the eggs it took out have to be put back, visibly, by a movement
   * anybody can see. A reversed dispatch stays on the record with the reason it
   * was reversed, which is the only version of events that explains the two sets
   * of movements underneath it.
   */
  reversedAt: Date | null;
  reversedByName: string | null;
  reversalReason: string | null;
}

export function isLive(dispatch: Pick<Dispatch, 'reversedAt'>): boolean {
  return dispatch.reversedAt === null;
}

/** How much produce went out, in the thing itself — eggs, not crates. */
export function baseUnitsOf(lines: Pick<DispatchLine, 'quantity' | 'unitsPerPack'>[]): number {
  return lines.reduce((total, l) => total + l.quantity * l.unitsPerPack, 0);
}

export function packsSentence(lines: DispatchLine[]): string {
  if (lines.length === 0) return 'Nothing on it.';
  return lines
    .map((l) => `${l.quantity} ${l.packLabel}${l.quantity === 1 ? '' : 's'} of ${l.productName}`)
    .join(', ');
}

// ---------------------------------------------------------------------------
// WHAT IS STILL OWED ON AN ORDER
// ---------------------------------------------------------------------------

/**
 * Packs dispatched per order line, counting only dispatches that stand.
 *
 * REVERSED DISPATCHES DO NOT COUNT. They are still on the record — they are just
 * not a thing that happened to the buyer's order, which is the whole point of
 * reversing rather than deleting.
 *
 * A dispatch line with no `salesOrderLineId` counts against nothing: it is
 * something added to a load at the gate that was never ordered, and forcing it
 * onto a line would make an order say it received something it never asked for.
 */
export function dispatchedByLine(dispatches: Dispatch[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const dispatch of dispatches) {
    if (!isLive(dispatch)) continue;
    for (const line of dispatch.lines) {
      if (!line.salesOrderLineId) continue;
      totals.set(
        line.salesOrderLineId,
        (totals.get(line.salesOrderLineId) ?? 0) + line.quantity,
      );
    }
  }
  return totals;
}

export interface LineProgress {
  lineId: string;
  productName: string;
  packLabel: string;
  ordered: number;
  dispatched: number;
  /** Never negative: what is still to go. Over-dispatch shows as `over`, not as -3. */
  outstanding: number;
  over: number;
}

export function progressOf(lines: OrderLine[], dispatches: Dispatch[]): LineProgress[] {
  const sent = dispatchedByLine(dispatches);
  return lines.map((line) => {
    const dispatched = sent.get(line.id) ?? 0;
    return {
      lineId: line.id,
      productName: line.productName,
      packLabel: line.packLabel,
      ordered: line.quantity,
      dispatched,
      outstanding: Math.max(0, line.quantity - dispatched),
      over: Math.max(0, dispatched - line.quantity),
    };
  });
}

export const FULFILMENTS = ['NOTHING_SENT', 'PART_SENT', 'SENT', 'OVER_SENT'] as const;
export type Fulfilment = (typeof FULFILMENTS)[number];

/**
 * What the dispatch rows add up to.
 *
 * OVER_SENT IS A REAL STATE, NOT AN ERROR. A buyer who takes two extra crates at
 * the gate has taken two extra crates; the store is short by two whatever the
 * order says. Hiding that behind "fulfilled" would make the ledger the only place
 * the truth survives, and nobody reads the ledger.
 */
export function fulfilmentOf(progress: LineProgress[]): Fulfilment {
  if (progress.length === 0) return 'NOTHING_SENT';
  if (progress.some((p) => p.over > 0)) return 'OVER_SENT';
  const dispatched = progress.reduce((n, p) => n + p.dispatched, 0);
  if (dispatched === 0) return 'NOTHING_SENT';
  return progress.every((p) => p.outstanding === 0) ? 'SENT' : 'PART_SENT';
}

export const FULFILMENT_LABELS: Record<Fulfilment, string> = {
  NOTHING_SENT: 'Nothing has gone out yet',
  PART_SENT: 'Part of it has gone out',
  SENT: 'All of it has gone out',
  OVER_SENT: 'More went out than was ordered',
};

export function fulfilmentSentence(progress: LineProgress[]): string {
  const state = fulfilmentOf(progress);
  if (state === 'NOTHING_SENT') return 'Nothing has gone out yet.';
  if (state === 'SENT') return 'Everything on this order has gone out.';

  if (state === 'OVER_SENT') {
    const extra = progress
      .filter((p) => p.over > 0)
      .map((p) => `${p.over} ${p.packLabel}${p.over === 1 ? '' : 's'} of ${p.productName}`)
      .join(', ');
    return `More went out than was ordered — ${extra} beyond it. The store is short by that much whatever the order says.`;
  }

  const left = progress
    .filter((p) => p.outstanding > 0)
    .map((p) => `${p.outstanding} ${p.packLabel}${p.outstanding === 1 ? '' : 's'} of ${p.productName}`)
    .join(', ');
  return `Still to go: ${left}.`;
}

// ---------------------------------------------------------------------------
// MAY THIS BE DISPATCHED AT ALL?
// ---------------------------------------------------------------------------

/**
 * Only a confirmed order may be dispatched against.
 *
 * A DRAFT IS NOT AN AGREEMENT. Sending produce against an order nobody confirmed
 * means the farm has delivered something the buyer never agreed a price for, and
 * the argument that follows has no record to settle it. A cancelled order is
 * plainer still.
 */
export function whyNotDispatchable(state: SalesOrderState): string | null {
  if (state === 'DRAFT') {
    return 'This order has not been confirmed with the buyer yet. Confirm it first — sending produce against an order nobody agreed leaves nothing to settle an argument with.';
  }
  if (state === 'CANCELLED') {
    return 'This order was cancelled. Nothing should go out against it.';
  }
  return null;
}

export function canDispatch(state: SalesOrderState): boolean {
  return whyNotDispatchable(state) === null;
}

// ---------------------------------------------------------------------------
// VALIDATION AND WARNINGS
// ---------------------------------------------------------------------------

export interface DispatchLineInput {
  salesOrderLineId: string | null;
  productId: string;
  /** Whole packs — crates, trays, birds. */
  quantity: number;
  /**
   * How many base units one pack holds.
   *
   * CARRIED ON THE INPUT rather than looked up, because the stock check compares
   * eggs against eggs while the person typing counts crates, and a conversion
   * that happens somewhere else is a conversion that eventually happens twice.
   */
  unitsPerPack: number;
}

/**
 * What makes a dispatch impossible to record at all.
 *
 * The list is short on purpose. Almost everything surprising about a load is a
 * WARNING — see below. These are the things that would produce a row nobody can
 * interpret afterwards.
 */
export function dispatchErrors(input: {
  lines: DispatchLineInput[];
  method: string;
  dispatchedOn: Date;
  today: Date;
}): string[] {
  const problems: string[] = [];

  const positive = input.lines.filter((l) => l.quantity > 0);
  if (positive.length === 0) {
    problems.push('Nothing is on this load. Say how many of something went out.');
  }

  if (positive.some((l) => !Number.isInteger(l.quantity))) {
    // The same rule as an order line, and for the same reason.
    problems.push('Whole packs only. If they took a part crate, record it as trays.');
  }

  if (positive.some((l) => l.quantity > 100_000)) {
    problems.push('That is a very large load. Check the figure.');
  }

  if (!(DISPATCH_METHODS as readonly string[]).includes(input.method)) {
    problems.push('Say whether the buyer collected it or the farm delivered it.');
  }

  const days = dayGap(input.dispatchedOn, input.today);
  if (days > 0) {
    problems.push('A load cannot go out in the future. Check the date.');
  } else if (days < -60) {
    problems.push(
      'That date is more than two months ago. Stock cannot be taken out that far back — record it as an adjustment instead, so the store shows when it was actually corrected.',
    );
  }

  return problems;
}

export interface AvailableStock {
  productId: string;
  productName: string;
  /** Base units on hand in the produce store, or null when this product is not held as stock. */
  onHandBase: number | null;
}

/**
 * Checks that make somebody look twice, in the warn-never-block spirit.
 *
 * THE LOAD IS ON THE VEHICLE BY THE TIME THIS IS TYPED. Refusing to record it
 * does not put the eggs back — it just means the store's figures are wrong AND
 * nobody knows why. So every one of these saves once the person confirms it.
 *
 * The one thing that is NOT here is the withdrawal gate. That is not a warning,
 * it is a refusal, and it lives in the service where it can be enforced rather
 * than acknowledged away. See `dispatch-service.ts`.
 */
export function dispatchWarnings(input: {
  lines: DispatchLineInput[];
  progress: LineProgress[];
  stock: AvailableStock[];
  method: DispatchMethod;
  receivedBy: string | null;
}): Warning[] {
  const warnings: Warning[] = [];
  const byLineId = new Map(input.progress.map((p) => [p.lineId, p]));

  for (const line of input.lines) {
    if (line.quantity <= 0) continue;

    const progress = line.salesOrderLineId ? byLineId.get(line.salesOrderLineId) : undefined;
    if (progress && line.quantity > progress.outstanding) {
      const extra = line.quantity - progress.outstanding;
      warnings.push({
        field: `quantity-${line.salesOrderLineId}`,
        message:
          progress.outstanding === 0
            ? `Everything ordered of ${progress.productName} has already gone out. This ${extra} is on top of the order.`
            : `That is ${extra} more ${progress.packLabel}${extra === 1 ? '' : 's'} of ${progress.productName} than the order still has outstanding.`,
      });
    }

    if (!line.salesOrderLineId) {
      warnings.push({
        field: `quantity-${line.productId}`,
        message: 'This was not on the order. It will go out and come off the store, but the order will not show it as fulfilled.',
      });
    }

    const stock = input.stock.find((s) => s.productId === line.productId);
    if (stock && stock.onHandBase !== null) {
      const needed = line.quantity * line.unitsPerPack;
      if (needed > stock.onHandBase) {
        const short = Math.round((needed - stock.onHandBase) * 100) / 100;
        warnings.push({
          field: `quantity-${line.productId}`,
          message: `The store says there are only ${stock.onHandBase} of ${stock.productName} on hand — this load needs ${needed}, which is ${short} more. It will be recorded as it happened and the store will show short.`,
        });
      }
    }
  }

  if (input.method === 'DELIVERED' && !input.receivedBy?.trim()) {
    warnings.push({
      field: 'receivedBy',
      message:
        'Nobody is written down as having received it. On a delivery that is the only record that it arrived.',
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// REVERSAL
// ---------------------------------------------------------------------------

export function reversalErrors(input: {
  alreadyReversed: boolean;
  reason: string;
}): string[] {
  const problems: string[] = [];
  if (input.alreadyReversed) problems.push('That dispatch has already been reversed.');
  if (input.reason.trim().length < 3) {
    problems.push(
      'Say why in a few words — a reversal with no reason is two sets of stock movements nobody can explain.',
    );
  }
  return problems;
}

export function reversalSentence(dispatch: Dispatch): string {
  if (isLive(dispatch)) return '';
  const who = dispatch.reversedByName ? ` by ${dispatch.reversedByName}` : '';
  const when = dispatch.reversedAt ? ` on ${dispatch.reversedAt.toISOString().slice(0, 10)}` : '';
  return `Reversed${who}${when}. ${dispatch.reversalReason ?? ''}`.trim();
}

// ---------------------------------------------------------------------------
// READING A LIST
// ---------------------------------------------------------------------------

/** Most recent first. A reversed dispatch keeps its place rather than sinking. */
export function sortDispatches(dispatches: Dispatch[]): Dispatch[] {
  return [...dispatches].sort((a, b) => {
    const byDay = b.dispatchedOn.getTime() - a.dispatchedOn.getTime();
    if (byDay !== 0) return byDay;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

export function dispatchSummary(dispatches: Dispatch[]): string {
  const live = dispatches.filter(isLive);
  if (live.length === 0) {
    return dispatches.length === 0
      ? 'Nothing has gone out yet.'
      : 'Nothing standing — every load recorded here was reversed.';
  }
  const eggs = live.reduce((n, d) => n + baseUnitsOf(d.lines), 0);
  const reversed = dispatches.length - live.length;
  const tail = reversed > 0 ? ` ${reversed} reversed.` : '';
  return `${live.length} ${live.length === 1 ? 'load' : 'loads'}, ${eggs} in all.${tail}`;
}

function dayGap(a: Date, b: Date): number {
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((day(a) - day(b)) / 86_400_000);
}
