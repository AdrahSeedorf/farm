import { type Pesewas, multiply, add, ZERO, formatGHS } from '@/lib/money';

/**
 * Sales orders — ADRAH Farms
 *
 * What a buyer asked for, at what price, and what state that order is in. Pure
 * arithmetic; no database.
 *
 * THE PRICE IS COPIED ONTO THE LINE, NOT LOOKED UP LATER.
 *
 *   Prices are dated rows (see pricing.ts), so the March price is always
 *   retrievable — but an order still snapshots what was actually agreed, for two
 *   reasons. The farm sometimes agrees a one-off figure that is on no price
 *   list at all; and a total that is recomputed on every page load is a total
 *   that can change after a customer has been told it. What was quoted is a
 *   fact about a conversation, and facts are stored.
 *
 * STATES ARE WHAT SOMEBODY DID. Fulfilment is not among them — the same rule as
 * purchasing. "Delivered" is what the dispatch records add up to, and storing it
 * as a status is how a status column comes to disagree with the rows beneath it.
 *
 * NOTHING HERE KNOWS HOW MONEY ARRIVES. There is no payment state, no "paid"
 * flag and no balance. That is not an oversight: the payment provider has not
 * been chosen, and a half-built payment model would have to be unpicked rather
 * than extended. What this module gives is what was agreed; what has been
 * received is a separate ledger that does not exist yet.
 */

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------

export const SALES_ORDER_STATES = ['DRAFT', 'CONFIRMED', 'CANCELLED'] as const;
export type SalesOrderState = (typeof SALES_ORDER_STATES)[number];

export const STATE_LABELS: Record<SalesOrderState, string> = {
  DRAFT: 'Being written',
  CONFIRMED: 'Confirmed with the buyer',
  CANCELLED: 'Cancelled',
};

/**
 * Lines can only be changed while an order is a draft.
 *
 * ONCE IT IS CONFIRMED IT IS A PROMISE somebody made on the phone, and quietly
 * editing it afterwards means the farm and the buyer are holding two different
 * orders. Changing a confirmed order means cancelling it and writing another,
 * which leaves both on the record — which is the point.
 */
export function linesAreEditable(state: SalesOrderState): boolean {
  return state === 'DRAFT';
}

export function whyLinesAreLocked(state: SalesOrderState): string | null {
  if (state === 'CONFIRMED') {
    return 'This order is confirmed with the buyer. Changing what was agreed without them knowing is how a farm and a shop end up holding two different orders — cancel it and write a new one instead.';
  }
  if (state === 'CANCELLED') return 'This order was cancelled.';
  return null;
}

// ---------------------------------------------------------------------------
// LINES AND TOTALS
// ---------------------------------------------------------------------------

/** Where the price on a line came from. Recorded, because it is asked about. */
export const PRICE_BASES = ['LIST', 'AGREED', 'MANUAL'] as const;
export type PriceBasis = (typeof PRICE_BASES)[number];

export const BASIS_LABELS: Record<PriceBasis, string> = {
  LIST: 'List price',
  AGREED: 'This buyer’s agreed price',
  MANUAL: 'Typed in for this order',
};

export interface OrderLine {
  id: string;
  productId: string;
  productName: string;
  packLabel: string;
  unitsPerPack: number;
  quantity: number;
  unitPricePesewas: Pesewas;
  priceBasis: PriceBasis;
  note: string | null;
}

export function lineTotal(line: Pick<OrderLine, 'quantity' | 'unitPricePesewas'>): Pesewas {
  return multiply(line.unitPricePesewas, line.quantity);
}

export function orderTotal(lines: Pick<OrderLine, 'quantity' | 'unitPricePesewas'>[]): Pesewas {
  return lines.length === 0 ? ZERO : add(...lines.map(lineTotal));
}

/**
 * How much produce the order comes to, in the thing itself.
 *
 * Crates are what a buyer orders; eggs are what has to leave the store. Both
 * are reported, because the person picking the order counts one and the person
 * checking production counts the other.
 */
export function orderBaseUnits(lines: Pick<OrderLine, 'quantity' | 'unitsPerPack'>[]): number {
  return lines.reduce((total, l) => total + l.quantity * l.unitsPerPack, 0);
}

export function lineSentence(line: OrderLine): string {
  const packs = `${line.quantity} ${line.packLabel}${line.quantity === 1 ? '' : 's'}`;
  return `${packs} at ${formatGHS(line.unitPricePesewas)} = ${formatGHS(lineTotal(line))}`;
}

// ---------------------------------------------------------------------------
// THE ORDER
// ---------------------------------------------------------------------------

export interface SalesOrder {
  id: string;
  orderNumber: string;
  state: SalesOrderState;
  customerId: string;
  customerName: string;
  customerPhone: string;
  siteId: string;
  siteName: string;
  orderedOn: Date;
  /** When the buyer wants it. Null while nobody has said. */
  wantedOn: Date | null;
  /**
   * Which house the produce is drawn from, where the farm has said.
   *
   * NULL IS ORDINARY. Eggs are pooled in the store and a crate cannot usually be
   * traced to a house — so this is empty on most orders. It becomes REQUIRED the
   * moment any house is inside a withdrawal period, because that is the only
   * circumstance in which the answer changes whether the sale may happen at all.
   * See `withdrawalGate`.
   */
  drawnFromFlockId: string | null;
  drawnFromFlockName: string | null;
  notes: string | null;
  lines: OrderLine[];
  totalPesewas: Pesewas;
  createdByName: string | null;
  confirmedAt: Date | null;
  confirmedByName: string | null;
  cancelledAt: Date | null;
  cancelledByName: string | null;
  cancelReason: string | null;
}

/** `SO-2026-0007`. Readable aloud down a phone, which is how orders get quoted. */
export function orderNumberFor(year: number, sequence: number): string {
  return `SO-${year}-${String(sequence).padStart(4, '0')}`;
}

export function sequenceOf(orderNumber: string, year: number): number {
  const match = new RegExp(`^SO-${year}-(\\d{4,})$`).exec(orderNumber);
  return match ? Number(match[1]) : 0;
}

// ---------------------------------------------------------------------------
// THE WITHDRAWAL GATE
// ---------------------------------------------------------------------------

export interface RestrictedFlock {
  flockId: string;
  name: string;
  clearsOn: Date;
}

export type WithdrawalVerdict =
  | { kind: 'CLEAR' }
  | { kind: 'NEEDS_SOURCE'; message: string; restricted: RestrictedFlock[] }
  | { kind: 'REFUSED'; message: string };

/**
 * May this order be confirmed, given what is under withdrawal today?
 *
 * THE HONEST VERSION OF A PROMISE THE FARM MAKES PUBLICLY.
 *
 *   The website says produce from a treated house is not sold until its
 *   withdrawal period has run. Eggs are pooled in the store, so most of the time
 *   this software cannot tell which house a crate came from — and a system that
 *   claimed to block by house while having no idea which house would be worse
 *   than one that says so.
 *
 *   So the rule is: while nothing is restricted, orders are ordinary and no
 *   question is asked. The moment a house IS restricted, an order for produce
 *   can no longer be confirmed without somebody saying which house it is drawn
 *   from — and if that house is the restricted one, the sale is refused
 *   outright, with the date it clears.
 *
 *   That makes the claim true rather than approximately true: a sale of
 *   restricted produce is refused, and a sale the farm cannot account for is
 *   stopped until somebody accounts for it.
 *
 * An order with no produce on it — nothing drawn from a flock — is never gated.
 */
export function withdrawalGate(input: {
  restricted: RestrictedFlock[];
  drawnFromFlockId: string | null;
  hasProduceLines: boolean;
}): WithdrawalVerdict {
  if (!input.hasProduceLines || input.restricted.length === 0) return { kind: 'CLEAR' };

  const blocked = input.restricted.find((r) => r.flockId === input.drawnFromFlockId);
  if (blocked) {
    return {
      kind: 'REFUSED',
      message: `${blocked.name} is inside a withdrawal period until ${blocked.clearsOn
        .toISOString()
        .slice(0, 10)}. Produce from that house cannot be sold, and this order says it comes from there.`,
    };
  }

  if (!input.drawnFromFlockId) {
    const names = input.restricted.map((r) => r.name).join(', ');
    return {
      kind: 'NEEDS_SOURCE',
      message: `${names} ${
        input.restricted.length === 1 ? 'is' : 'are'
      } inside a withdrawal period, so this order cannot be confirmed until somebody says which house the produce comes from. Eggs are pooled in the store — the software cannot tell, and will not guess.`,
      restricted: input.restricted,
    };
  }

  return { kind: 'CLEAR' };
}

// ---------------------------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------------------------

export function lineErrors(input: { quantity: number; unitPricePesewas: Pesewas | null }): string[] {
  const problems: string[] = [];

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    problems.push('How many? A number above zero.');
  } else if (!Number.isInteger(input.quantity)) {
    // HALF A CRATE IS A TRAY, AND A TRAY IS ITS OWN PRODUCT. Allowing fractions
    // here would let the same quantity mean two things depending on who typed it.
    problems.push('Whole packs only. If they want a part crate, sell them trays instead.');
  } else if (input.quantity > 100_000) {
    problems.push('That is a very large order. Check the figure.');
  }

  if (input.unitPricePesewas === null) {
    problems.push(
      'There is no price for this product, and nothing can be sold without one. Set a list price first, or type a price for this order.',
    );
  } else if (input.unitPricePesewas < 0) {
    problems.push('A price cannot be negative.');
  }

  return problems;
}

export function confirmErrors(order: Pick<SalesOrder, 'state' | 'lines'>): string[] {
  if (order.state !== 'DRAFT') {
    return ['Only a draft can be confirmed.'];
  }
  if (order.lines.length === 0) {
    return ['There is nothing on this order yet.'];
  }
  return [];
}

export function cancelErrors(input: { state: SalesOrderState; reason: string }): string[] {
  const problems: string[] = [];
  if (input.state === 'CANCELLED') problems.push('That order is already cancelled.');
  if (input.reason.trim().length < 3) {
    problems.push('Say why in a few words — a cancelled order with no reason is one nobody can explain.');
  }
  return problems;
}

// ---------------------------------------------------------------------------
// READING A LIST
// ---------------------------------------------------------------------------

/**
 * Drafts first, then confirmed by when the buyer wants it.
 *
 * A DRAFT IS UNFINISHED WORK and belongs at the top: somebody started it and
 * stopped, and an order nobody confirmed is an order the buyer thinks was
 * placed. Cancelled sinks to the bottom.
 */
export function sortOrders(orders: SalesOrder[]): SalesOrder[] {
  const rank = (o: SalesOrder) =>
    o.state === 'DRAFT' ? 0 : o.state === 'CONFIRMED' ? 1 : 2;

  return [...orders].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (a.state === 'CONFIRMED' && b.state === 'CONFIRMED') {
      const aw = a.wantedOn?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bw = b.wantedOn?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (aw !== bw) return aw - bw;
    }
    return b.orderedOn.getTime() - a.orderedOn.getTime();
  });
}

export function orderSummary(orders: SalesOrder[]): string {
  if (orders.length === 0) return 'No orders yet.';
  const drafts = orders.filter((o) => o.state === 'DRAFT').length;
  const confirmed = orders.filter((o) => o.state === 'CONFIRMED');
  const value = orderTotal(confirmed.flatMap((o) => o.lines));

  const parts: string[] = [];
  if (drafts > 0) parts.push(`${drafts} still being written`);
  if (confirmed.length > 0) {
    parts.push(`${confirmed.length} confirmed, ${formatGHS(value)}`);
  }
  return parts.length > 0 ? `${parts.join(' · ')}.` : 'Nothing outstanding.';
}

/**
 * The same summary for a reader who may not see money.
 *
 * A DRIVER HOLDS `order:view` AND NOT `price:view`. They still need to know how
 * many orders are waiting; they have no business knowing what the farm charged.
 * Counting is the part of the summary that survives that split.
 */
export function orderCountSentence(orders: SalesOrder[]): string {
  if (orders.length === 0) return 'No orders yet.';
  const drafts = orders.filter((o) => o.state === 'DRAFT').length;
  const confirmed = orders.filter((o) => o.state === 'CONFIRMED').length;

  const parts: string[] = [];
  if (drafts > 0) parts.push(`${drafts} still being written`);
  if (confirmed > 0) {
    parts.push(`${confirmed} confirmed ${confirmed === 1 ? 'order' : 'orders'}`);
  }
  return parts.length > 0 ? `${parts.join(' · ')}.` : 'Nothing outstanding.';
}

/**
 * What a buyer has been committed to, and what is NOT known about it.
 *
 * DELIBERATELY NOT CALLED A BALANCE. A balance is what is owed, and that needs
 * payments — which are not recorded anywhere yet. Calling this figure a balance
 * would put a number on a screen that a farm would chase somebody for.
 */
export function committedSentence(orders: SalesOrder[]): string {
  const confirmed = orders.filter((o) => o.state === 'CONFIRMED');
  if (confirmed.length === 0) return 'Nothing confirmed.';
  const value = orderTotal(confirmed.flatMap((o) => o.lines));
  return `${formatGHS(value)} across ${confirmed.length} confirmed ${
    confirmed.length === 1 ? 'order' : 'orders'
  }. This is what was agreed, not what is owed — payments are not recorded yet.`;
}
