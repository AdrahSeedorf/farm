import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { orderById, orderContext, withdrawalCheck } from '@/lib/sales-service';
import {
  STATE_LABELS,
  BASIS_LABELS,
  linesAreEditable,
  whyLinesAreLocked,
  lineTotal,
  orderBaseUnits,
} from '@/lib/sales';
import { formatGHS } from '@/lib/money';
import { formatGhanaPhone } from '@/lib/brand';
import { listDispatches } from '@/lib/dispatch-service';
import { progressOf, fulfilmentSentence, packsSentence, isLive } from '@/lib/dispatch';
import {
  AddLineForm,
  RemoveLineForm,
  DrawnFromForm,
  ConfirmForm,
  CancelOrderForm,
} from '../OrderForms';
import { RecordLoadForm } from '../../dispatch/DispatchForms';

export const metadata: Metadata = { title: 'Order' };

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function OrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { principal, allowed } = await pageGuard('order:view');
  if (!allowed) return <Forbidden area="orders" roles={principal.roles} />;

  const { orderId } = await params;
  // See the note on the orders list: a driver may read an order and may not read
  // what it is worth. The figures are omitted from the markup, not hidden in it.
  const [order, canEdit, canSeeMoney, canSeeLoads, canDispatchThis] = await Promise.all([
    orderById(principal, orderId),
    currentUserCan('order:edit'),
    currentUserCan('price:view'),
    currentUserCan('delivery:view'),
    currentUserCan('delivery:create'),
  ]);
  if (!order) notFound();

  const [{ products, flocks }, verdict, dispatches] = await Promise.all([
    orderContext(principal),
    withdrawalCheck(principal, order),
    canSeeLoads ? listDispatches(principal, { salesOrderId: order.id }) : Promise.resolve([]),
  ]);
  const progress = progressOf(order.lines, dispatches);

  const editable = linesAreEditable(order.state);
  const locked = whyLinesAreLocked(order.state);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/orders" className="text-[14px] font-semibold text-brand-primary">
        ← Orders
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{order.orderNumber}</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            <Link
              href={`/customers/${order.customerId}`}
              className="font-semibold text-brand-primary hover:underline"
            >
              {order.customerName}
            </Link>
            {' · '}
            <a
              href={`tel:${order.customerPhone}`}
              className="hover:text-brand-primary"
            >
              {formatGhanaPhone(order.customerPhone)}
            </a>
          </p>
          <p className="mt-0.5 text-[13.5px] text-text-muted">
            {STATE_LABELS[order.state]} · taken {day(order.orderedOn)}
            {order.createdByName ? ` by ${order.createdByName}` : ''}
            {order.wantedOn ? ` · wanted ${day(order.wantedOn)}` : ''}
          </p>
        </div>
        {canSeeMoney ? (
          <span className="tabular text-[24px] font-bold text-text-primary">
            {formatGHS(order.totalPesewas)}
          </span>
        ) : null}
      </div>

      {order.state === 'CANCELLED' ? (
        <p className="mt-5 rounded-control border border-border-strong bg-surface-sunken px-4 py-3 text-[14px] text-text-primary">
          Cancelled{order.cancelledByName ? ` by ${order.cancelledByName}` : ''}
          {order.cancelledAt ? ` on ${day(order.cancelledAt)}` : ''}.
          {order.cancelReason ? ` ${order.cancelReason}` : ''}
        </p>
      ) : null}

      {order.state === 'CONFIRMED' ? (
        <p className="mt-5 rounded-control border border-brand-primary bg-brand-primary-soft px-4 py-3 text-[14px] font-medium text-brand-primary">
          Confirmed{order.confirmedByName ? ` by ${order.confirmedByName}` : ''}
          {order.confirmedAt ? ` on ${day(order.confirmedAt)}` : ''}. The buyer is holding you
          to this.
        </p>
      ) : null}

      {/* THE WITHDRAWAL GATE, SHOWN BEFORE SOMEBODY TRIES. A refusal at the
          moment of confirming is correct but late; saying it here means the
          person on the phone knows before they promise anything. */}
      {verdict.kind !== 'CLEAR' && order.state === 'DRAFT' ? (
        <div
          role="alert"
          className="mt-5 rounded-card border border-status-critical bg-status-critical-bg p-5"
        >
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-status-critical">
            Withdrawal period in force
          </h2>
          <p className="mt-2 text-[15px] font-medium text-status-critical">{verdict.message}</p>
          {/* THE FORM STAYS UP WHILE THE ORDER IS REFUSED, not only while the
              house is unnamed. Somebody who picks the wrong house from a list of
              two must be able to correct it; showing the form only for
              NEEDS_SOURCE left them refused with nothing to change, and the only
              way out was cancelling an order that was never wrong. */}
          {canEdit ? (
            <DrawnFromForm
              orderId={order.id}
              flocks={flocks}
              current={order.drawnFromFlockId}
            />
          ) : null}
        </div>
      ) : null}

      <section className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
          What they want
        </h2>

        {order.lines.length === 0 ? (
          <p className="mt-3 text-[14px] text-text-secondary">Nothing on it yet.</p>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-border-default">
              {order.lines.map((line) => (
                <li key={line.id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-[15px] font-semibold text-text-primary">
                      {line.quantity} {line.packLabel}
                      {line.quantity === 1 ? '' : 's'} · {line.productName}
                    </span>
                    {canSeeMoney ? (
                      <span className="tabular text-[15px] font-bold text-text-primary">
                        {formatGHS(lineTotal(line))}
                      </span>
                    ) : null}
                  </div>
                  {/* A DIV, NOT A PARAGRAPH. The remove control is a form, and a
                      form inside a <p> is closed by the HTML parser before React
                      ever sees it — the markup the server sends and the tree the
                      browser builds stop matching, and hydration fails on a page
                      whose other buttons then quietly stop working. */}
                  <div className="mt-0.5 text-[13px] text-text-muted">
                    {canSeeMoney
                      ? `${formatGHS(line.unitPricePesewas)} each · ${BASIS_LABELS[line.priceBasis]}`
                      : `${line.unitsPerPack * line.quantity} in all`}
                    {line.note ? ` · ${line.note}` : ''}
                    {editable && canEdit ? (
                      <>
                        {' · '}
                        <RemoveLineForm orderId={order.id} lineId={line.id} />
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>

            {/* SAID IN BOTH UNITS. Crates are what the buyer ordered; eggs are
                what has to leave the store, and the person picking counts one
                while the person checking production counts the other. */}
            <p className="mt-3 border-t border-border-default pt-3 text-[14px] text-text-secondary">
              {orderBaseUnits(order.lines)} in all, across {order.lines.length}{' '}
              {order.lines.length === 1 ? 'line' : 'lines'}.
            </p>
          </>
        )}

        {locked ? (
          <p className="mt-4 rounded-control border border-border-strong bg-surface-sunken px-3 py-2.5 text-[13.5px] text-text-secondary">
            {locked}
          </p>
        ) : null}

        {editable && canEdit && products.length > 0 ? (
          <div className="mt-5 border-t border-border-default pt-5">
            <AddLineForm orderId={order.id} products={products} />
          </div>
        ) : null}

        {editable && products.length === 0 ? (
          <p className="mt-4 text-[14px] text-text-secondary">
            There is nothing to sell yet —{' '}
            <Link href="/pricing/new" className="font-semibold text-brand-primary hover:underline">
              add a product
            </Link>
            .
          </p>
        ) : null}
      </section>

      {order.notes ? (
        <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
            Notes
          </h2>
          <p className="mt-3 whitespace-pre-line text-[15px] text-text-primary">{order.notes}</p>
        </section>
      ) : null}

      {order.drawnFromFlockName ? (
        <p className="mt-6 text-[14px] text-text-secondary">
          Produce drawn from <span className="font-semibold">{order.drawnFromFlockName}</span>.
        </p>
      ) : null}

      {/* WHAT HAS ACTUALLY GONE OUT.
          Derived from the dispatch rows every time — there is no `delivered`
          flag anywhere, because a flag is what starts disagreeing with the rows
          beneath it. */}
      {canSeeLoads && order.state !== 'DRAFT' ? (
        <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
              What has gone out
            </h2>
            {dispatches.length > 0 ? (
              <Link href="/dispatch" className="text-[13px] font-semibold text-brand-primary">
                All loads
              </Link>
            ) : null}
          </div>

          <p className="mt-3 text-[15px] text-text-primary">{fulfilmentSentence(progress)}</p>

          {dispatches.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {dispatches.map((d) => (
                <li key={d.id} className="text-[13.5px]">
                  <Link
                    href={`/dispatch/${d.id}`}
                    className={`font-semibold hover:underline ${
                      isLive(d) ? 'text-brand-primary' : 'text-text-muted line-through'
                    }`}
                  >
                    {d.reference}
                  </Link>
                  <span className="text-text-secondary">
                    {' '}
                    · {day(d.dispatchedOn)} · {packsSentence(d.lines)}
                    {isLive(d) ? '' : ' · reversed'}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {canDispatchThis && order.state === 'CONFIRMED' ? (
            <div className="mt-5 border-t border-border-default pt-5">
              <h3 className="text-[15px] font-semibold text-text-primary">Record a load</h3>
              <p className="mt-1 mb-4 text-[13.5px] text-text-secondary">
                This takes produce off the store. Leave a box blank for anything that did not go.
              </p>
              <RecordLoadForm
                orderId={order.id}
                lines={progress.map((p) => ({
                  id: p.lineId,
                  productName: p.productName,
                  packLabel: p.packLabel,
                  ordered: p.ordered,
                  dispatched: p.dispatched,
                  outstanding: p.outstanding,
                }))}
                today={day(new Date())}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {/* WHAT THIS ORDER DOES NOT DO, said plainly. A confirmed order that
          silently failed to record money would be discovered by somebody
          counting the takings. */}
      <section className="mt-8 rounded-card border border-border-default bg-surface-sunken p-6">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-text-muted">
          What this does not do
        </h2>
        <p className="mt-2 text-[14px] text-text-secondary">
          Confirming an order is a promise, not a movement — produce leaves the store only when
          somebody records a load against it. No money is recorded anywhere: how payment is taken
          has not been decided, so there is deliberately nowhere to put it yet.
        </p>
      </section>

      {canEdit && order.state === 'DRAFT' ? (
        <div className="mt-8 space-y-4 border-t border-border-default pt-5">
          {order.lines.length > 0 ? <ConfirmForm orderId={order.id} /> : null}
          <CancelOrderForm orderId={order.id} />
        </div>
      ) : null}

      {canEdit && order.state === 'CONFIRMED' ? (
        <div className="mt-8 border-t border-border-default pt-5">
          <CancelOrderForm orderId={order.id} />
        </div>
      ) : null}
    </main>
  );
}
