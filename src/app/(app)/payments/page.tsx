import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { db } from '@/lib/db';
import { orgFilter } from '@/lib/scope';
import { listPayments, outstandingBuyers } from '@/lib/payment-service';
import {
  sortPayments,
  paymentSummary,
  isLive,
  METHOD_LABELS,
} from '@/lib/payments';
import { formatGHS, pesewas } from '@/lib/money';
import { ReceivePaymentForm, ReversePaymentForm } from './PaymentForms';

export const metadata: Metadata = { title: 'Money in' };

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Money in.
 *
 * WHO OWES WHAT COMES FIRST, because that is what somebody opens this screen to
 * find out. The list of payments underneath is the evidence for it.
 */
export default async function PaymentsPage() {
  const { principal, allowed } = await pageGuard('payment:view');
  if (!allowed) return <Forbidden area="payments" roles={principal.roles} />;

  const [payments, owing, customers, canReceive] = await Promise.all([
    listPayments(principal),
    outstandingBuyers(principal),
    db.customer.findMany({
      where: { ...orgFilter(principal), archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, businessName: true },
    }),
    currentUserCan('payment:create'),
  ]);

  const sorted = sortPayments(payments);
  const inDebt = owing.filter((o) => o.balance.owedPesewas > 0);
  const inCredit = owing.filter((o) => o.balance.owedPesewas < 0);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="text-2xl font-bold text-text-primary">Money in</h1>
      <p className="mt-1 text-[15px] text-text-secondary">{paymentSummary(payments)}</p>

      <section className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
          Who owes what
        </h2>

        {inDebt.length === 0 && inCredit.length === 0 ? (
          <p className="mt-3 text-[14px] text-text-secondary">
            Nobody owes anything. A buyer appears here once an order is confirmed with them.
          </p>
        ) : null}

        {inDebt.length > 0 ? (
          <ul className="mt-3 divide-y divide-border-default">
            {inDebt.map((row) => (
              <li key={row.customerId} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <Link
                    href={`/customers/${row.customerId}`}
                    className="text-[15px] font-semibold text-text-primary hover:text-brand-primary"
                  >
                    {row.customerName}
                  </Link>
                  <span className="tabular text-[16px] font-bold text-text-primary">
                    {formatGHS(row.balance.owedPesewas)}
                  </span>
                </div>
                <p className="mt-0.5 text-[13px] text-text-muted">
                  {formatGHS(row.balance.committedPesewas)} agreed across{' '}
                  {row.balance.confirmedOrders}{' '}
                  {row.balance.confirmedOrders === 1 ? 'order' : 'orders'},{' '}
                  {formatGHS(row.balance.receivedPesewas)} received.
                </p>
              </li>
            ))}
          </ul>
        ) : null}

        {/* PAID AHEAD IS A REAL STATE, and worth showing separately: the farm is
            holding somebody's money, which is the opposite problem. */}
        {inCredit.length > 0 ? (
          <div className="mt-5 border-t border-border-default pt-4">
            <h3 className="text-[13px] font-semibold text-text-secondary">Paid ahead</h3>
            <ul className="mt-2 space-y-1.5">
              {inCredit.map((row) => (
                <li key={row.customerId} className="flex justify-between gap-3 text-[14px]">
                  <Link
                    href={`/customers/${row.customerId}`}
                    className="font-medium text-brand-primary hover:underline"
                  >
                    {row.customerName}
                  </Link>
                  <span className="tabular font-semibold text-text-primary">
                    {formatGHS(pesewas(Math.abs(row.balance.owedPesewas)))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {canReceive && customers.length > 0 ? (
        <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
            Record a payment
          </h2>
          <div className="mt-4">
            <ReceivePaymentForm customers={customers} today={day(new Date())} />
          </div>
        </section>
      ) : null}

      <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
          What has come in
        </h2>
        {sorted.length === 0 ? (
          <p className="mt-3 text-[14px] text-text-secondary">Nothing yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border-default">
            {sorted.map((payment) => (
              <li key={payment.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span
                    className={`text-[15px] font-semibold ${
                      isLive(payment) ? 'text-text-primary' : 'text-text-muted line-through'
                    }`}
                  >
                    {payment.reference} · {payment.customerName}
                  </span>
                  <span
                    className={`tabular text-[16px] font-bold ${
                      isLive(payment) ? 'text-text-primary' : 'text-text-muted'
                    }`}
                  >
                    {formatGHS(payment.amountPesewas)}
                  </span>
                </div>
                <div className="mt-0.5 text-[13px] text-text-muted">
                  {day(payment.receivedOn)} · {METHOD_LABELS[payment.method]}
                  {payment.receivedBy ? ` · taken by ${payment.receivedBy}` : ''}
                  {payment.recordedByName ? ` · recorded by ${payment.recordedByName}` : ''}
                  {isLive(payment) ? null : (
                    <span className="block text-status-attention">
                      Reversed{payment.reversedByName ? ` by ${payment.reversedByName}` : ''}
                      {payment.reversalReason ? `. ${payment.reversalReason}` : ''}
                    </span>
                  )}
                </div>
                {isLive(payment) ? (
                  <div className="mt-1">
                    <ReversePaymentForm paymentId={payment.id} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 rounded-card border border-border-default bg-surface-sunken p-6">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-text-muted">
          What this does not do
        </h2>
        <p className="mt-2 text-[14px] text-text-secondary">
          A payment is recorded against a buyer, not against a particular order — money arrives
          against a person, and deciding which order it settles is a separate job nobody has asked
          for yet. Nothing here talks to a bank or a mobile money provider: cash is counted and
          mobile money is typed in from the alert, which is how the farm is actually paid.
        </p>
      </section>
    </main>
  );
}
