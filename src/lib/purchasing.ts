import { pesewas, multiply, formatGHS, type Pesewas } from '@/lib/money';

/**
 * Purchasing — ADRAH Farms
 *
 * What was ordered, what actually turned up, and what it actually cost. Pure
 * arithmetic; no database.
 *
 * THE DISTINCTION THE WHOLE MODULE TURNS ON: AN ORDER IS AN EXPECTATION AND A
 * RECEIPT IS A FACT.
 *
 *   An order says twenty bags at GHS 260. The lorry brings twenty-one at 275,
 *   and one of them is torn. Every one of those differences is ordinary, and a
 *   system that treated the order as the truth would either refuse the delivery
 *   or quietly rewrite what was agreed. So the order is kept as it was placed,
 *   the receipt is kept as it happened, and the gap between them is REPORTED —
 *   because that gap is the single most useful thing purchasing records can
 *   tell a farm about a supplier.
 *
 * Money is integer pesewas throughout. See src/lib/money.ts.
 */

// ---------------------------------------------------------------------------
// THE TWO KINDS OF STATE
// ---------------------------------------------------------------------------

/**
 * What somebody DID to the order. Stored, because each is a human act.
 *
 * Deliberately does not include "received" or "part received". Those are not
 * things anybody does to an order; they are what the receipts add up to, and
 * storing them as a status is how a status column comes to disagree with the
 * rows beneath it. See `fulfilmentOf`.
 */
export const ORDER_STATES = ['DRAFT', 'SENT', 'CANCELLED'] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export const ORDER_STATE_LABELS: Record<OrderState, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent to the supplier',
  CANCELLED: 'Cancelled',
};

/** What the receipts add up to. DERIVED, never stored. */
export type Fulfilment = 'NOTHING' | 'PART' | 'COMPLETE' | 'OVER';

export const FULFILMENT_LABELS: Record<Fulfilment, string> = {
  NOTHING: 'Nothing received',
  PART: 'Part received',
  COMPLETE: 'Received in full',
  OVER: 'More received than ordered',
};

// ---------------------------------------------------------------------------
// LINES
// ---------------------------------------------------------------------------

export interface OrderLine {
  itemId: string;
  itemName: string;
  /** How many, in the unit it was ordered in. */
  quantityOrdered: number;
  /** The unit as ordered — bags, not kilograms. See unitKey below. */
  unitKey: string;
  /** Agreed price per ORDERED unit, in pesewas. */
  unitPricePesewas: number;
  /** Sum of everything received against this line, in the same ordered unit. */
  quantityReceived: number;
}

/**
 * What a line was expected to cost.
 *
 * FORMULA: quantityOrdered × unitPrice
 *
 * Priced per ORDERED unit, not per base unit. A farm agrees a price per bag,
 * and translating that into a price per kilogram before storing it means every
 * screen has to translate it back — and one of them eventually will not.
 */
export function lineTotal(line: Pick<OrderLine, 'quantityOrdered' | 'unitPricePesewas'>): Pesewas {
  return multiply(pesewas(Math.round(line.unitPricePesewas)), line.quantityOrdered);
}

/** What the whole order was expected to cost. */
export function orderTotal(lines: OrderLine[]): Pesewas {
  return pesewas(lines.reduce((sum, l) => sum + lineTotal(l), 0));
}

/** Still to come on a line. Never negative — an over-delivery is not a negative shortfall. */
export function outstandingOf(line: OrderLine): number {
  return Math.max(0, round(line.quantityOrdered - line.quantityReceived));
}

/** Delivered beyond what was ordered. Zero on a normal line. */
export function overOf(line: OrderLine): number {
  return Math.max(0, round(line.quantityReceived - line.quantityOrdered));
}

/**
 * Where an order stands, from its receipts alone.
 *
 * FORMULA
 *   NOTHING   nothing received on any line
 *   COMPLETE  every line received in full, none over
 *   OVER      any line received beyond what was ordered
 *   PART      anything else
 *
 * OVER WINS OVER COMPLETE. An order where one line came in short and another
 * came in long is not "complete"; it is an order somebody needs to look at, and
 * the label has to say so rather than averaging the two into a tick.
 */
export function fulfilmentOf(lines: OrderLine[]): Fulfilment {
  if (lines.length === 0) return 'NOTHING';

  const received = lines.reduce((sum, l) => sum + Math.max(0, l.quantityReceived), 0);
  if (received === 0) return 'NOTHING';

  if (lines.some((l) => overOf(l) > 0)) return 'OVER';
  return lines.every((l) => outstandingOf(l) === 0) ? 'COMPLETE' : 'PART';
}

/** What is still outstanding, line by line, for the chasing list. */
export function outstandingLines(lines: OrderLine[]): OrderLine[] {
  return lines.filter((l) => outstandingOf(l) > 0);
}

/** One sentence on where an order stands. */
export function fulfilmentSentence(lines: OrderLine[]): string {
  const state = fulfilmentOf(lines);

  if (state === 'NOTHING') return 'Nothing has been received against this order yet.';
  if (state === 'COMPLETE') return 'Everything ordered has been received.';

  if (state === 'OVER') {
    const over = lines.filter((l) => overOf(l) > 0);
    const named = over
      .map((l) => `${round(overOf(l))} ${l.unitKey} more ${l.itemName}`)
      .join(', ');
    return `${named} arrived than was ordered. The extra is recorded — check the invoice against it.`;
  }

  const short = outstandingLines(lines);
  const named = short
    .map((l) => `${round(outstandingOf(l))} ${l.unitKey} ${l.itemName}`)
    .join(', ');
  return `Still to come: ${named}.`;
}

// ---------------------------------------------------------------------------
// WHAT IT ACTUALLY COST
// ---------------------------------------------------------------------------

export interface PriceVariance {
  /** Received price − ordered price, per unit, in pesewas. */
  differencePesewas: number;
  /** As a share of the ordered price, 0 = no change. Null when nothing was agreed. */
  pctOfOrdered: number | null;
  dearer: boolean;
}

/**
 * How the price actually invoiced compares with the price agreed.
 *
 * THE RECEIVED PRICE IS THE ONE THAT ENTERS STOCK. The order price is what a
 * farm expected to pay; the delivery note is what it did pay, and stock
 * valuation that used the expectation would be wrong by exactly the amount
 * worth knowing about.
 *
 * Returns null when no price was agreed on the order — plenty of deliveries on
 * a small farm are arranged by phone with the price settled on arrival, and
 * reporting a variance against nothing would be inventing one.
 */
export function priceVariance(
  orderedUnitPesewas: number | null,
  receivedUnitPesewas: number | null,
): PriceVariance | null {
  if (
    orderedUnitPesewas === null ||
    receivedUnitPesewas === null ||
    !Number.isFinite(orderedUnitPesewas) ||
    !Number.isFinite(receivedUnitPesewas)
  ) {
    return null;
  }

  const difference = Math.round(receivedUnitPesewas - orderedUnitPesewas);
  return {
    differencePesewas: difference,
    pctOfOrdered:
      orderedUnitPesewas === 0 ? null : (difference / orderedUnitPesewas) * 100,
    dearer: difference > 0,
  };
}

export function priceVarianceSentence(
  variance: PriceVariance,
  itemName: string,
  unitKey: string,
): string {
  if (variance.differencePesewas === 0) {
    return `${itemName} came in at the price agreed.`;
  }
  const amount = formatGHS(pesewas(Math.abs(variance.differencePesewas)));
  const pct =
    variance.pctOfOrdered === null ? '' : ` (${Math.abs(variance.pctOfOrdered).toFixed(0)}%)`;
  return (
    `${itemName} came in ${amount}${pct} ${variance.dearer ? 'dearer' : 'cheaper'} ` +
    `per ${unitKey} than the order said.`
  );
}

// ---------------------------------------------------------------------------
// WHEN IT SHOULD ARRIVE
// ---------------------------------------------------------------------------

/**
 * A SUGGESTED delivery date from the farm's own lead time.
 *
 * A suggestion, filled into a field somebody can change — never an assertion.
 * The lead time is an average of past experience; this particular supplier on
 * this particular week may be quicker or slower, and only the person placing
 * the order knows which.
 */
export function suggestedDelivery(orderedOn: Date, leadTimeDays: number | null): Date | null {
  if (leadTimeDays === null || !Number.isFinite(leadTimeDays) || leadTimeDays <= 0) return null;
  const due = new Date(orderedOn.getTime());
  due.setUTCDate(due.getUTCDate() + Math.round(leadTimeDays));
  return due;
}

export type Lateness = 'NO_DATE' | 'DUE_LATER' | 'DUE_TODAY' | 'LATE';

export interface OrderTiming {
  status: Lateness;
  /** Whole days late. Null unless LATE. */
  daysLate: number | null;
  /** Whole days until it is due. Null unless DUE_LATER. */
  daysToGo: number | null;
}

/**
 * Whether an order is late, against the date on the ORDER — not against the
 * farm's average lead time.
 *
 * Measuring lateness against an average would make every order from a slow
 * supplier permanently late and every order from a fast one permanently early,
 * which tells nobody anything. The date somebody agreed with the supplier is
 * the only date worth being late against.
 */
export function orderTiming(
  expectedOn: Date | null,
  asOf: Date = new Date(),
): OrderTiming {
  if (!expectedOn) return { status: 'NO_DATE', daysLate: null, daysToGo: null };

  const days = Math.round((startOfDay(asOf) - startOfDay(expectedOn)) / 86_400_000);

  if (days > 0) return { status: 'LATE', daysLate: days, daysToGo: null };
  if (days === 0) return { status: 'DUE_TODAY', daysLate: null, daysToGo: 0 };
  return { status: 'DUE_LATER', daysLate: null, daysToGo: -days };
}

export function timingSentence(timing: OrderTiming): string {
  switch (timing.status) {
    case 'NO_DATE':
      return 'No delivery date was agreed.';
    case 'DUE_TODAY':
      return 'Due today.';
    case 'DUE_LATER':
      return `Due in ${timing.daysToGo} day${timing.daysToGo === 1 ? '' : 's'}.`;
    case 'LATE':
      return `${timing.daysLate} day${timing.daysLate === 1 ? '' : 's'} past the agreed date.`;
  }
}

// ---------------------------------------------------------------------------
// CHECKS
// ---------------------------------------------------------------------------

export interface PurchaseWarning {
  field: string;
  message: string;
}

export interface ReceiptAgainstOrder {
  orderState: OrderState;
  line: OrderLine;
  /** How much is being received now, in the ordered unit. */
  quantityNow: number;
  /** Price per ordered unit on this delivery, in pesewas. Null when not stated. */
  unitPricePesewas: number | null;
}

/**
 * What to say before recording a delivery against an order.
 *
 * WARN, NEVER BLOCK — the house rule. Twenty-one bags arrived; refusing to
 * record the twenty-first does not send it back, it just means the store is
 * wrong by one bag and nobody knows why.
 */
export function checkReceiptAgainstOrder(input: ReceiptAgainstOrder): PurchaseWarning[] {
  const warnings: PurchaseWarning[] = [];
  const { line, quantityNow } = input;

  if (input.orderState === 'CANCELLED') {
    warnings.push({
      field: 'order',
      message:
        'This order was cancelled. If the goods turned up anyway, record them — but the ' +
        'cancellation stays on the record, and somebody should find out why they came.',
    });
  }

  if (input.orderState === 'DRAFT') {
    warnings.push({
      field: 'order',
      message:
        'This order has not been sent to the supplier. Receiving against a draft usually ' +
        'means the order was placed by phone and written up afterwards, which is fine — ' +
        'mark it sent so the record matches what happened.',
    });
  }

  const after = round(line.quantityReceived + quantityNow);
  const over = round(after - line.quantityOrdered);
  if (over > 0) {
    warnings.push({
      field: 'quantity',
      message:
        `That takes ${line.itemName} to ${after} ${line.unitKey} against ${line.quantityOrdered} ` +
        `ordered — ${over} more than the order. Check the delivery note before you sign it.`,
    });
  }

  const variance = priceVariance(line.unitPricePesewas, input.unitPricePesewas);
  // A tenth is the point at which a price difference stops being rounding or a
  // small market move and starts being worth a phone call before signing.
  if (variance && variance.pctOfOrdered !== null && Math.abs(variance.pctOfOrdered) >= 10) {
    warnings.push({
      field: 'price',
      message: priceVarianceSentence(variance, line.itemName, line.unitKey),
    });
  }

  return warnings;
}

/** Reasons an order cannot be saved at all. These block. */
export function orderErrors(lines: OrderLine[]): string[] {
  const errors: string[] = [];

  if (lines.length === 0) errors.push('An order needs at least one line.');

  if (lines.some((l) => !Number.isFinite(l.quantityOrdered) || l.quantityOrdered <= 0)) {
    errors.push('Every line needs a quantity above zero.');
  }

  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.itemId)) {
      errors.push(`${line.itemName} is on this order twice. Put it on one line.`);
      break;
    }
    seen.add(line.itemId);
  }

  return errors;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
