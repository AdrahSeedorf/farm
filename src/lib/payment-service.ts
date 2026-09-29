import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter } from '@/lib/scope';
import { pesewas, type Pesewas } from '@/lib/money';
import { warningToken, type Warning } from '@/lib/warnings';
import { listOrders } from '@/lib/sales-service';
import {
  referenceFor,
  sequenceOf,
  balanceOf,
  paymentErrors,
  paymentWarnings,
  reversalErrors,
  type Payment,
  type PaymentMethod,
  type Balance,
} from '@/lib/payments';

/**
 * Payment service — ADRAH Farms
 *
 * THE ONLY PLACE A Payment IS WRITTEN.
 *
 * NOTHING HERE TALKS TO A PAYMENT PROVIDER, and that is the point rather than a
 * gap. Cash is counted by hand and MoMo to a merchant number arrives as an alert
 * on somebody's phone — both are recorded, not fetched. When a card gateway
 * exists it will call `recordPayment` like any other caller; it does not need a
 * second table, a second balance or a second set of rules, and building those in
 * advance would mean unpicking them.
 *
 * A BALANCE IS DERIVED, ALWAYS. There is no `balance` column on Customer and
 * there must never be one: it is confirmed orders less live payments, worked out
 * from the rows each time. The moment it becomes a stored number it starts
 * disagreeing with the rows beneath it, and a farm chases somebody for money
 * they already paid.
 */

export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentError';
  }
}

const include = {
  customer: { select: { id: true, name: true, businessName: true } },
  recordedBy: { select: { name: true } },
  reversedBy: { select: { name: true } },
} as const;

type DbPayment = Awaited<ReturnType<typeof findPayments>>[number];

function findPayments(where: object) {
  return db.payment.findMany({
    where,
    orderBy: [{ receivedOn: 'desc' }, { createdAt: 'desc' }],
    include,
  });
}

function toPayment(row: DbPayment): Payment {
  return {
    id: row.id,
    reference: row.reference,
    customerId: row.customerId,
    customerName: row.customer.businessName
      ? `${row.customer.businessName} · ${row.customer.name}`
      : row.customer.name,
    amountPesewas: pesewas(row.amountPesewas),
    method: row.method as PaymentMethod,
    receivedOn: row.receivedOn,
    receivedBy: row.receivedBy,
    notes: row.notes,
    recordedByName: row.recordedBy?.name ?? null,
    createdAt: row.createdAt,
    reversedAt: row.reversedAt,
    reversedByName: row.reversedBy?.name ?? null,
    reversalReason: row.reversalReason,
  };
}

// ---------------------------------------------------------------------------
// READING
// ---------------------------------------------------------------------------

export async function listPayments(
  principal: Principal,
  options: { customerId?: string } = {},
): Promise<Payment[]> {
  const rows = await findPayments({
    ...orgFilter(principal),
    ...(options.customerId ? { customerId: options.customerId } : {}),
  });
  return rows.map(toPayment);
}

export async function paymentById(
  principal: Principal,
  paymentId: string,
): Promise<Payment | null> {
  const row = await db.payment.findFirst({
    where: { id: paymentId, ...orgFilter(principal) },
    include,
  });
  return row ? toPayment(row) : null;
}

/**
 * What one buyer owes.
 *
 * Both sides are read fresh: the orders from the sales service, the payments
 * from here. Nothing is cached and nothing is stored.
 */
export async function balanceFor(
  principal: Principal,
  customerId: string,
): Promise<{ balance: Balance; payments: Payment[] }> {
  const [orders, payments] = await Promise.all([
    listOrders(principal, { customerId }),
    listPayments(principal, { customerId }),
  ]);
  return { balance: balanceOf(orders, payments), payments };
}

/**
 * Every buyer who owes something, most owed first.
 *
 * DERIVED IN MEMORY, DELIBERATELY. The alternative is a SQL sum of orders less a
 * SQL sum of payments, which is faster and which would express the balance rule
 * a second time — in a language where the "only confirmed orders count" clause is
 * easy to forget. One farm's buyer list is small; one definition of what is owed
 * is worth more than the milliseconds.
 */
export async function outstandingBuyers(
  principal: Principal,
): Promise<{ customerId: string; customerName: string; balance: Balance }[]> {
  const customers = await db.customer.findMany({
    where: { ...orgFilter(principal), archivedAt: null },
    select: { id: true, name: true, businessName: true },
  });

  const rows = await Promise.all(
    customers.map(async (customer) => {
      const { balance } = await balanceFor(principal, customer.id);
      return {
        customerId: customer.id,
        customerName: customer.businessName
          ? `${customer.businessName} · ${customer.name}`
          : customer.name,
        balance,
      };
    }),
  );

  return rows
    .filter((r) => r.balance.owedPesewas !== 0)
    .sort((a, b) => b.balance.owedPesewas - a.balance.owedPesewas);
}

// ---------------------------------------------------------------------------
// RECORDING
// ---------------------------------------------------------------------------

export interface RecordPaymentInput {
  customerId: string;
  amountPesewas: Pesewas | null;
  method: PaymentMethod;
  receivedOn: Date;
  receivedBy: string | null;
  externalRef: string | null;
  notes: string | null;
}

export type PaymentResult =
  | { status: 'recorded'; id: string; reference: string; balance: Balance }
  /** Warn, never block — but only for the warnings the person actually read. */
  | { status: 'needsConfirmation'; warnings: Warning[]; token: string }
  | { status: 'refused'; message: string };

export async function recordPayment(
  principal: Principal,
  input: RecordPaymentInput,
  acknowledgedToken: string | null = null,
  today: Date = new Date(),
): Promise<PaymentResult> {
  const customer = await db.customer.findFirst({
    where: { id: input.customerId, ...orgFilter(principal), archivedAt: null },
    select: { id: true },
  });
  if (!customer) return { status: 'refused', message: 'That buyer is not on the list.' };

  const problems = paymentErrors({
    amountPesewas: input.amountPesewas,
    method: input.method,
    receivedOn: input.receivedOn,
    today,
    reference: input.externalRef,
    receivedBy: input.receivedBy,
  });
  if (problems.length > 0) return { status: 'refused', message: problems[0] };

  const amount = input.amountPesewas as Pesewas;
  const { balance } = await balanceFor(principal, input.customerId);

  const warnings = paymentWarnings({
    amountPesewas: amount,
    method: input.method,
    reference: input.externalRef,
    receivedBy: input.receivedBy,
    balance,
  });
  if (warnings.length > 0) {
    const token = warningToken(warnings);
    if (acknowledgedToken !== token) {
      return { status: 'needsConfirmation', warnings, token };
    }
  }

  const created = await db.$transaction(async (tx) => {
    const reference = await nextReference(tx, principal.organisationId, input.receivedOn);
    return tx.payment.create({
      data: {
        organisationId: principal.organisationId,
        customerId: input.customerId,
        reference,
        amountPesewas: amount,
        method: input.method,
        receivedOn: input.receivedOn,
        receivedBy: input.receivedBy,
        // Cash never carries one; storing an empty string would make "has a
        // reference" untrue in a way no query would notice.
        externalRef: input.externalRef?.trim() || null,
        notes: input.notes,
        recordedById: principal.userId,
      },
      select: { id: true, reference: true },
    });
  });

  const after = await balanceFor(principal, input.customerId);
  return {
    status: 'recorded',
    id: created.id,
    reference: created.reference,
    balance: after.balance,
  };
}

/**
 * The next PAY number for the year, inside the caller's transaction.
 *
 * Read-then-write with a unique index behind it, and the action retries on a
 * collision — the same approach as orders and loads. Deliberately not a
 * sequence: a sequence that skips numbers on a rolled-back transaction leaves
 * gaps in a series people read as receipts.
 */
async function nextReference(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  organisationId: string,
  on: Date,
): Promise<string> {
  const year = on.getUTCFullYear();
  const latest = await tx.payment.findFirst({
    where: { organisationId, reference: { startsWith: `PAY-${year}-` } },
    orderBy: { reference: 'desc' },
    select: { reference: true },
  });
  return referenceFor(year, sequenceOf(latest?.reference ?? '', year) + 1);
}

// ---------------------------------------------------------------------------
// REVERSING
// ---------------------------------------------------------------------------

/**
 * Take a payment back off the books.
 *
 * NOT A DELETE AND NOT AN EDIT. Money that was recorded and should not have been
 * is a thing that happened — somebody typed it, somebody else may have told a
 * customer their balance because of it. The row stays with the reason on it, and
 * the balance moves because live payments no longer include it.
 *
 * THIS IS ALSO HOW A REFUND IS RECORDED, for now. Giving money back because the
 * eggs were bad is not the same act as correcting a typo, and it deserves its own
 * record eventually — but a reversal with the reason written on it is honest
 * about what happened, where a negative payment row would quietly corrupt every
 * total on every screen.
 */
export async function reversePayment(
  principal: Principal,
  paymentId: string,
  reason: string,
  today: Date = new Date(),
): Promise<{ reference: string; balance: Balance }> {
  const existing = await db.payment.findFirst({
    where: { id: paymentId, ...orgFilter(principal) },
    select: { id: true, reference: true, customerId: true, reversedAt: true },
  });
  if (!existing) throw new PaymentError('That payment no longer exists.');

  const problems = reversalErrors({
    alreadyReversed: existing.reversedAt !== null,
    reason,
  });
  if (problems.length > 0) throw new PaymentError(problems[0]);

  await db.payment.update({
    where: { id: paymentId },
    data: {
      reversedAt: today,
      reversedById: principal.userId,
      reversalReason: reason.trim(),
    },
  });

  const { balance } = await balanceFor(principal, existing.customerId);
  return { reference: existing.reference, balance };
}
