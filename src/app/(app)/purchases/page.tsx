import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { listOrders } from '@/lib/order-service';
import { ORDER_STATE_LABELS, FULFILMENT_LABELS } from '@/lib/purchasing';
import { formatGHS } from '@/lib/money';

export const metadata: Metadata = { title: 'Purchases' };

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Every order, newest first.
 *
 * The two badges say DIFFERENT THINGS and are shown separately on purpose. The
 * state is what somebody did — drafted it, sent it, cancelled it. The
 * fulfilment is what the receipts add up to. Collapsing them into one
 * "status" column is how a status comes to disagree with the rows beneath it.
 */
export default async function PurchasesPage() {
  const { principal, allowed } = await pageGuard('procurement:view');
  if (!allowed) return <Forbidden area="ordering" roles={principal.roles} />;

  const [orders, canCreate] = await Promise.all([
    listOrders(principal),
    currentUserCan('procurement:create'),
  ]);

  const open = orders.filter((o) => o.state === 'SENT' && o.fulfilment !== 'COMPLETE');
  const late = open.filter((o) => o.timing.status === 'LATE');

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Purchases</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            What has been ordered, from whom, and whether it turned up.
          </p>
        </div>
        {canCreate ? (
          <Link
            href="/purchases/new"
            className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
          >
            Place an order
          </Link>
        ) : null}
      </div>

      {open.length > 0 ? (
        <p
          className={`mt-6 rounded-control border px-4 py-3 text-[14px] ${
            late.length > 0
              ? 'border-status-attention bg-status-attention-bg font-medium text-status-attention'
              : 'border-border-default bg-surface-card text-text-secondary'
          }`}
        >
          {late.length > 0
            ? `${late.length} order${late.length === 1 ? ' is' : 's are'} past the date agreed with the supplier.`
            : `${open.length} order${open.length === 1 ? '' : 's'} out with suppliers, none of them late.`}
        </p>
      ) : null}

      {orders.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border-strong bg-surface-card p-10 text-center">
          <h2 className="text-lg font-semibold text-text-primary">Nothing ordered yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-text-secondary">
            An order records what the farm asked for and what it agreed to pay. Keeping it
            means the day a delivery is short or dearer than agreed, there is something to
            hold it against.
          </p>
          {canCreate ? (
            <Link
              href="/purchases/new"
              className="mt-6 inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
            >
              Place the first order
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/purchases/${order.id}`}
                className="block rounded-card border border-border-default bg-surface-card p-5 transition-colors hover:border-brand-primary"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="text-[17px] font-bold text-text-primary">
                    {order.supplierName}
                  </h2>
                  <span className="font-mono text-[13px] font-semibold text-text-muted">
                    {order.orderNumber}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-[12px] font-semibold ${
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
                    <span className="rounded bg-surface-sunken px-2 py-0.5 text-[12px] font-semibold text-text-secondary">
                      {FULFILMENT_LABELS[order.fulfilment]}
                    </span>
                  ) : null}
                  {order.state === 'SENT' && order.timing.status === 'LATE' ? (
                    <span className="rounded bg-status-attention-bg px-2 py-0.5 text-[12px] font-semibold text-status-attention">
                      {order.timingSentence}
                    </span>
                  ) : null}
                </div>

                <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-border-default pt-3 text-[13px]">
                  <div>
                    <dt className="text-text-muted">Ordered</dt>
                    <dd className="tabular font-semibold text-text-primary">
                      {day(order.orderedOn)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">Promised</dt>
                    <dd className="tabular font-semibold text-text-primary">
                      {order.expectedOn ? day(order.expectedOn) : 'No date agreed'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">Lines</dt>
                    <dd className="tabular font-semibold text-text-primary">
                      {order.lines.length}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">Expected cost</dt>
                    <dd className="tabular font-semibold text-text-primary">
                      {order.lines.length === 0 ? '—' : formatGHS(order.totalPesewas)}
                      {order.totalIsPartial && order.lines.length > 0 ? (
                        <span className="ml-1 font-normal text-text-muted">so far</span>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">To</dt>
                    <dd className="font-semibold text-text-primary">{order.siteName}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
