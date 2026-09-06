import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { orderById, orderContext } from '@/lib/order-service';
import {
  ORDER_STATE_LABELS,
  FULFILMENT_LABELS,
  whyLinesAreLocked,
  lineTotal,
  outstandingOf,
  overOf,
} from '@/lib/purchasing';
import { formatGHS, pesewas } from '@/lib/money';
import { whatsappLink, telLink, formatGhanaPhone } from '@/lib/ghana';
import { AddLineForm } from '../AddLineForm';
import { SendOrderForm, CancelOrderForm, RemoveLineButton } from '../OrderStateForms';

export const metadata: Metadata = { title: 'Order' };

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function OrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const { principal, allowed } = await pageGuard('procurement:view');
  if (!allowed) return <Forbidden area="ordering" roles={principal.roles} />;

  const order = await orderById(principal, orderId);
  if (!order) notFound();

  const [canEdit, canCreate, canReceive] = await Promise.all([
    currentUserCan('procurement:edit'),
    currentUserCan('procurement:create'),
    currentUserCan('inventory:create'),
  ]);

  // Only fetched when there is actually a form to fill in.
  const context = order.linesEditable && canCreate ? await orderContext(principal) : null;
  const supplier = context?.suppliers.find((s) => s.id === order.supplierId) ?? null;
  const locked = whyLinesAreLocked(order.state);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/purchases" className="text-[14px] font-semibold text-brand-primary">
        ← Purchases
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{order.supplierName}</h1>
          <p className="mt-1 font-mono text-[14px] font-semibold text-text-muted">
            {order.orderNumber}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
        {canReceive && order.lines.length > 0 ? (
          <Link
            href={`/purchases/${order.id}/receive`}
            className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
          >
            Record a delivery
          </Link>
        ) : null}
        {canEdit && order.state !== 'CANCELLED' ? (
          <Link
            href={`/purchases/${order.id}/edit`}
            className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-5 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
          >
            Edit details
          </Link>
        ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-2.5 py-1 text-[13px] font-semibold ${
            order.state === 'CANCELLED'
              ? 'bg-status-critical-bg text-status-critical'
              : order.state === 'SENT'
                ? 'bg-brand-primary-soft text-brand-primary'
                : 'bg-surface-sunken text-text-secondary'
          }`}
        >
          {ORDER_STATE_LABELS[order.state]}
        </span>
        {order.state === 'SENT' ? (
          <span className="rounded bg-surface-sunken px-2.5 py-1 text-[13px] font-semibold text-text-secondary">
            {FULFILMENT_LABELS[order.fulfilment]}
          </span>
        ) : null}
      </div>

      {order.state === 'CANCELLED' ? (
        <div className="mt-5 rounded-control border border-status-critical bg-status-critical-bg px-4 py-3">
          <p className="text-[14px] font-semibold text-status-critical">
            Cancelled{order.cancelledAt ? ` on ${day(order.cancelledAt)}` : ''}
          </p>
          <p className="mt-1 text-[14px] text-text-primary">{order.cancelReason}</p>
          <p className="mt-2 text-[13px] text-text-secondary">
            The order and its lines are kept. If goods turn up against it anyway, record
            them — the receiving screen will say the order was cancelled.
          </p>
        </div>
      ) : null}

      {/* WHERE IT STANDS: two separate sentences, because they answer two
          different questions and averaging them into one would lose both. */}
      <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
        <p className="text-[15px] text-text-primary">{order.fulfilmentSentence}</p>
        <p className="mt-1 text-[15px] text-text-secondary">{order.timingSentence}</p>

        <dl className="mt-5 grid gap-4 border-t border-border-default pt-4 sm:grid-cols-3">
          <div>
            <dt className="text-[13px] text-text-muted">Ordered on</dt>
            <dd className="tabular text-[15px] font-semibold text-text-primary">
              {day(order.orderedOn)}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-text-muted">Promised for</dt>
            <dd className="tabular text-[15px] font-semibold text-text-primary">
              {order.expectedOn ? day(order.expectedOn) : 'No date agreed'}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-text-muted">Delivering to</dt>
            <dd className="text-[15px] font-semibold text-text-primary">{order.siteName}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-text-muted">Placed by</dt>
            <dd className="text-[15px] text-text-primary">{order.placedByName}</dd>
          </div>
          {order.sentAt ? (
            <div>
              <dt className="text-[13px] text-text-muted">Sent</dt>
              <dd className="tabular text-[15px] text-text-primary">{day(order.sentAt)}</dd>
            </div>
          ) : null}
        </dl>

        {order.supplierPhone ? (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-border-default pt-4">
            {telLink(order.supplierPhone) ? (
              <a
                href={telLink(order.supplierPhone)!}
                className="inline-flex min-h-touch items-center rounded-control border border-border-strong px-4 text-[14px] font-semibold text-text-primary hover:bg-surface-sunken"
              >
                Call {formatGhanaPhone(order.supplierPhone)}
              </a>
            ) : null}
            {whatsappLink(order.supplierPhone) ? (
              <a
                href={whatsappLink(order.supplierPhone)!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-touch items-center rounded-control border border-border-strong px-4 text-[14px] font-semibold text-text-primary hover:bg-surface-sunken"
              >
                WhatsApp about {order.orderNumber}
              </a>
            ) : null}
          </div>
        ) : null}

        {order.notes ? (
          <p className="mt-5 whitespace-pre-line border-t border-border-default pt-4 text-[14px] text-text-secondary">
            {order.notes}
          </p>
        ) : null}
      </section>

      {/* THE LINES */}
      <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
        <h2 className="text-lg font-semibold text-text-primary">What was ordered</h2>

        {order.lines.length === 0 ? (
          <p className="mt-2 text-[15px] text-text-secondary">
            Nothing on it yet. An order with no lines cannot be sent.
          </p>
        ) : (
          <>
            <ul className="mt-4 divide-y divide-border-default">
              {order.lines.map((line) => (
                <li key={line.id} className="flex items-start justify-between gap-4 py-3">
                  <div>
                    <p className="text-[15px] font-semibold text-text-primary">
                      {line.itemName}
                    </p>
                    <p className="tabular mt-0.5 text-[14px] text-text-secondary">
                      {line.quantityOrdered} {line.unitKey}
                      {line.lineTotalPesewas === null ? (
                        <span className="ml-2 text-text-muted">no price agreed</span>
                      ) : (
                        <>
                          {' '}
                          at {formatGHS(pesewas(line.unitPricePesewas))} each —{' '}
                          <span className="font-semibold text-text-primary">
                            {formatGHS(lineTotal(line))}
                          </span>
                        </>
                      )}
                    </p>
                    {/* WHAT ARRIVED, on its own line and in the ordered unit.
                        Never written over the figure above it. */}
                    {line.quantityReceived > 0 || order.state === 'SENT' ? (
                      <p
                        className={`tabular mt-0.5 text-[13px] ${
                          overOf(line) > 0
                            ? 'font-semibold text-status-attention'
                            : 'text-text-muted'
                        }`}
                      >
                        {line.quantityReceived === 0
                          ? 'None received yet.'
                          : overOf(line) > 0
                            ? `${line.quantityReceived} ${line.unitKey} received — ${overOf(line)} more than ordered.`
                            : outstandingOf(line) === 0
                              ? `${line.quantityReceived} ${line.unitKey} received in full.`
                              : `${line.quantityReceived} ${line.unitKey} received, ${outstandingOf(line)} still to come.`}
                      </p>
                    ) : null}
                    {line.notes ? (
                      <p className="mt-0.5 text-[13px] text-text-muted">{line.notes}</p>
                    ) : null}
                  </div>
                  {order.linesEditable && canEdit ? (
                    <RemoveLineButton
                      orderId={order.id}
                      lineId={line.id}
                      itemName={line.itemName}
                    />
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-baseline justify-between border-t border-border-strong pt-3">
              <span className="text-[15px] font-semibold text-text-primary">
                Expected cost
              </span>
              <span className="tabular text-[17px] font-bold text-text-primary">
                {formatGHS(order.totalPesewas)}
              </span>
            </div>
            {order.totalIsPartial ? (
              <p className="mt-1 text-right text-[13px] text-text-muted">
                Lines with no agreed price are not counted. This is what the priced lines
                come to, not the bill.
              </p>
            ) : null}
          </>
        )}
      </section>

      {locked ? (
        <p className="mt-6 rounded-control border border-border-default bg-surface-sunken px-4 py-3 text-[14px] text-text-secondary">
          {locked}
        </p>
      ) : null}

      {context && supplier ? (
        <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
          <h2 className="text-lg font-semibold text-text-primary">Add a line</h2>
          <p className="mt-1 text-[14px] text-text-secondary">
            What {order.supplierName} sells is offered first. Everything else is still
            there — a farm buys the odd thing from whoever has it.
          </p>
          <div className="mt-4">
            <AddLineForm
              orderId={order.id}
              items={context.items}
              units={context.units}
              usedItemIds={order.lines.map((l) => l.itemId)}
              supplies={supplier.supplies}
            />
          </div>
        </section>
      ) : null}

      {/* Rendered for a SENT order too, so the confirmation survives the send.
          See the note in SendOrderForm. */}
      {canEdit && order.state !== 'CANCELLED' ? (
        <section className="mt-6 rounded-card border border-border-default bg-surface-sunken p-6">
          <h2 className="text-[15px] font-semibold text-text-primary">
            {order.state === 'SENT' ? 'Sent' : 'Send it'}
          </h2>
          <div className="mt-3">
            <SendOrderForm orderId={order.id} sent={order.state === 'SENT'} />
          </div>
        </section>
      ) : null}

      {/* Rendered for a cancelled order too — see the note in CancelOrderForm.
          The component owns its own section so a cancelled order shows no
          empty card. */}
      {canEdit ? (
        <CancelOrderForm orderId={order.id} cancelled={order.state === 'CANCELLED'} />
      ) : null}

    </main>
  );
}
