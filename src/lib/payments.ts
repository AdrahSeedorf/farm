import { type Pesewas, formatGHS, add, subtract, ZERO, pesewas } from '@/lib/money';
import { orderTotal, type SalesOrder } from '@/lib/sales';

/**
 * Payments — ADRAH Farms
 *
 * MONEY ARRIVING. The other half of a sale, and the last big hole in it.
 *
 * A PAYMENT IS AGAINST A BUYER, NOT AGAINST AN ORDER.
 *
 *   A cold store hands over GHS 500 that covers part of Tuesday's order and all
 *   of Thursday's, or pays ahead of an order nobody has written yet. Money
 *   arrives against a person; deciding which invoice it settles is a separate,
 *   later act of bookkeeping. Systems that force payment-to-invoice at the moment
 *   of receipt teach people to invent an allocation to get the form to submit,
 *   and then the allocation is the thing that is wrong.
 *
 *   So a balance here is simple and honest: what was agreed on confirmed orders,
 *   less what has been received. It does not claim to know which order is paid.
 *
 * APPEND-ONLY, LIKE EVERY OTHER LEDGER. A payment entered wrongly is reversed
 * with a reason, never edited and never deleted. Two rows and an explanation
 * beat one row that quietly changed.
 *
 * NO PROVIDER, AND NONE NEEDED FOR THESE.
 *
 *   Cash is counted by hand. MoMo to a merchant number arrives as an alert on
 *   somebody's phone and is typed in with its transaction ID. Neither needs an
 *   integration, and between them they are most of what a Ghanaian farm takes.
 *   A card gateway writes into this same ledger when there is one; it is a later
 *   task and this module is deliberately shaped so that it plugs in rather than
 *   replaces anything.
 */

// ---------------------------------------------------------------------------
// HOW THE MONEY ARRIVED
// ---------------------------------------------------------------------------

export const PAYMENT_METHODS = ['CASH', 'MOMO', 'CARD', 'BANK'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  MOMO: 'Mobile money',
  CARD: 'Card',
  BANK: 'Bank transfer',
};

export const METHOD_HINTS: Record<PaymentMethod, string> = {
  CASH: 'Counted by hand. Say who took it.',
  MOMO: 'Paid to the farm’s merchant number. Put the transaction ID in the reference.',
  CARD: 'Paid by card. Put the gateway’s reference in the reference.',
  BANK: 'Transferred to the farm’s account. Put the bank reference in the reference.',
};

/**
 * Which methods should carry a reference.
 *
 * CASH IS THE ONE THAT CANNOT. There is no transaction ID for notes in a hand —
 * the record of a cash payment is the name of the person who took it, which is
 * why that field exists. Everything else leaves a trace somewhere else, and
 * writing that trace down here is what makes the two reconcilable later.
 */
export function wantsReference(method: PaymentMethod): boolean {
  return method !== 'CASH';
}

// ---------------------------------------------------------------------------
// THE RECORD
// ---------------------------------------------------------------------------

export interface Payment {
  id: string;
  reference: string | null;
  customerId: string;
  customerName: string;
  amountPesewas: Pesewas;
  method: PaymentMethod;
  receivedOn: Date;
  /** Who physically took it. The only trace a cash payment leaves. */
  receivedBy: string | null;
  notes: string | null;
  recordedByName: string | null;
  createdAt: Date;
  /** REVERSED, NEVER DELETED. A payment entered wrongly is two rows and a reason. */
  reversedAt: Date | null;
  reversedByName: string | null;
  reversalReason: string | null;
}

export function isLive(payment: Pick<Payment, 'reversedAt'>): boolean {
  return payment.reversedAt === null;
}

export function receivedTotal(payments: Payment[]): Pesewas {
  const live = payments.filter(isLive);
  return live.length === 0 ? ZERO : add(...live.map((p) => p.amountPesewas));
}

// ---------------------------------------------------------------------------
// WHAT A BUYER OWES
// ---------------------------------------------------------------------------

export interface Balance {
  /** Agreed on confirmed orders. Cancelled and draft orders are not debts. */
  committedPesewas: Pesewas;
  /** Received and not reversed. */
  receivedPesewas: Pesewas;
  /** committed − received. NEGATIVE means they have paid ahead. */
  owedPesewas: Pesewas;
  confirmedOrders: number;
  livePayments: number;
}

/**
 * What this buyer owes.
 *
 *   owed = agreed on confirmed orders − payments received
 *
 * ONLY CONFIRMED ORDERS COUNT AS A DEBT. A draft is an order somebody started
 * and has not agreed with the buyer; a cancelled one is not owed by anybody.
 * Charging either would put a figure on a screen that a farm would chase
 * somebody for.
 *
 * A NEGATIVE BALANCE IS A REAL STATE, NOT AN ERROR. Wholesale buyers pay ahead,
 * and a system that clamped this to zero would lose the fact that the farm is
 * holding somebody's money.
 */
export function balanceOf(orders: SalesOrder[], payments: Payment[]): Balance {
  const confirmed = orders.filter((o) => o.state === 'CONFIRMED');
  const committed = orderTotal(confirmed.flatMap((o) => o.lines));
  const received = receivedTotal(payments);

  return {
    committedPesewas: committed,
    receivedPesewas: received,
    owedPesewas: subtract(committed, received),
    confirmedOrders: confirmed.length,
    livePayments: payments.filter(isLive).length,
  };
}

/**
 * The balance in a sentence.
 *
 * THE WORD "OWES" IS ONLY USED WHEN SOMETHING IS ACTUALLY OWED. The rest of the
 * time it says what is true instead — settled, or paid ahead. A screen that
 * prints "owes GHS 0.00" invites somebody to ring a customer who owes nothing.
 */
export function balanceSentence(balance: Balance): string {
  if (balance.confirmedOrders === 0 && balance.livePayments === 0) {
    return 'Nothing confirmed and nothing received.';
  }

  if (balance.owedPesewas > 0) {
    return `Owes ${formatGHS(balance.owedPesewas)} — ${formatGHS(
      balance.committedPesewas,
    )} agreed across ${balance.confirmedOrders} confirmed ${
      balance.confirmedOrders === 1 ? 'order' : 'orders'
    }, ${formatGHS(balance.receivedPesewas)} received.`;
  }

  if (balance.owedPesewas < 0) {
    const ahead = pesewas(Math.abs(balance.owedPesewas));
    return `Paid ${formatGHS(ahead)} ahead — they have given the farm more than has been agreed so far.`;
  }

  return `Settled — ${formatGHS(balance.committedPesewas)} agreed, ${formatGHS(
    balance.receivedPesewas,
  )} received.`;
}

/** Owing money is ordinary; owing it for a long time is what deserves attention. */
export function isInDebt(balance: Balance): boolean {
  return balance.owedPesewas > 0;
}

// ---------------------------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------------------------

export function paymentErrors(input: {
  amountPesewas: Pesewas | null;
  method: string;
  receivedOn: Date;
  today: Date;
  reference: string | null;
  receivedBy: string | null;
}): string[] {
  const problems: string[] = [];

  if (input.amountPesewas === null) {
    problems.push('How much? Write it like 500 or 500.50.');
  } else if (input.amountPesewas <= 0) {
    // A refund is not a negative payment — it is its own act, and pretending
    // otherwise makes every total on every screen quietly wrong.
    problems.push('A payment has to be more than nothing. To give money back, reverse the payment it came from.');
  } else if (input.amountPesewas > 100_000_000) {
    problems.push('That is over a million cedis. Check the figure.');
  }

  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) {
    problems.push('How did the money arrive?');
  }

  const days = dayGap(input.receivedOn, input.today);
  if (days > 0) {
    problems.push('Money cannot arrive in the future. Check the date.');
  } else if (days < -365) {
    problems.push('That is more than a year ago. Check the date.');
  }

  return problems;
}

export type { Warning } from '@/lib/warnings';

/**
 * Things worth a second look, none of which stop the money being recorded.
 *
 * THE CASH IS ALREADY IN SOMEBODY'S POCKET by the time this is typed. Refusing
 * the entry does not un-take it; it just means the farm's books are wrong and
 * nobody knows why.
 */
export function paymentWarnings(input: {
  amountPesewas: Pesewas;
  method: PaymentMethod;
  reference: string | null;
  receivedBy: string | null;
  balance: Balance;
}): { field: string; message: string }[] {
  const warnings: { field: string; message: string }[] = [];

  if (wantsReference(input.method) && !input.reference?.trim()) {
    warnings.push({
      field: 'reference',
      message: `A ${METHOD_LABELS[input.method].toLowerCase()} payment leaves a reference somewhere. Without it this cannot be matched against the statement later.`,
    });
  }

  if (input.method === 'CASH' && !input.receivedBy?.trim()) {
    warnings.push({
      field: 'receivedBy',
      message:
        'Nobody is written down as having taken this cash. That name is the only record a cash payment leaves.',
    });
  }

  // Paying more than is owed is ordinary among wholesale buyers, and worth
  // saying out loud so nobody has mistyped a figure.
  if (input.amountPesewas > input.balance.owedPesewas && input.balance.owedPesewas > 0) {
    const over = pesewas(input.amountPesewas - input.balance.owedPesewas);
    warnings.push({
      field: 'amount',
      message: `That is ${formatGHS(over)} more than they owe. It will be recorded and they will be in credit.`,
    });
  } else if (input.balance.owedPesewas <= 0) {
    warnings.push({
      field: 'amount',
      message:
        'This buyer owes nothing at the moment, so all of this is money paid ahead of an order.',
    });
  }

  return warnings;
}

export function reversalErrors(input: { alreadyReversed: boolean; reason: string }): string[] {
  const problems: string[] = [];
  if (input.alreadyReversed) problems.push('That payment has already been reversed.');
  if (input.reason.trim().length < 3) {
    problems.push('Say why in a few words — a reversed payment with no reason is money nobody can account for.');
  }
  return problems;
}

// ---------------------------------------------------------------------------
// READING A LIST
// ---------------------------------------------------------------------------

/** Most recent first. A reversed payment keeps its place rather than sinking. */
export function sortPayments(payments: Payment[]): Payment[] {
  return [...payments].sort((a, b) => {
    const byDay = b.receivedOn.getTime() - a.receivedOn.getTime();
    if (byDay !== 0) return byDay;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

export function paymentSummary(payments: Payment[]): string {
  const live = payments.filter(isLive);
  if (live.length === 0) {
    return payments.length === 0
      ? 'Nothing received yet.'
      : 'Nothing standing — every payment recorded here was reversed.';
  }
  const reversed = payments.length - live.length;
  const tail = reversed > 0 ? ` ${reversed} reversed.` : '';
  return `${formatGHS(receivedTotal(payments))} across ${live.length} ${
    live.length === 1 ? 'payment' : 'payments'
  }.${tail}`;
}

/** `PAY-2026-0007`. Written on a receipt the buyer can be handed. */
export function referenceFor(year: number, sequence: number): string {
  return `PAY-${year}-${String(sequence).padStart(4, '0')}`;
}

export function sequenceOf(reference: string, year: number): number {
  const match = new RegExp(`^PAY-${year}-(\\d{4,})$`).exec(reference);
  return match ? Number(match[1]) : 0;
}

function dayGap(a: Date, b: Date): number {
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((day(a) - day(b)) / 86_400_000);
}
