import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { listOrders } from '@/lib/sales-service';
import { sortOrders, orderSummary, orderCountSentence, STATE_LABELS } from '@/lib/sales';
import { formatGHS } from '@/lib/money';

export const metadata: Metadata = { title: 'Orders' };

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Orders.
 *
 * DRAFTS AT THE TOP. An order somebody started and did not confirm is an order
 * the buyer believes was placed, and it is the only state on this screen that
 * represents work half done. Confirmed orders sort by when the buyer wants them.
 */
export default async function OrdersPage() {
  const { principal, allowed } = await pageGuard('order:view');
  if (!allowed) return <Forbidden area="orders" roles={principal.roles} />;

  /**
   * MONEY IS A SEPARATE PERMISSION FROM THE ORDER ITSELF.
   *
   * `driver` holds `order:view` and no `price:view` — they need to know what to
   * load onto the vehicle, not what the farm charged for it. Reusing the same
   * rule the pricing screens follow keeps one answer to "who sees figures?"
   * rather than one answer per screen.
   */
  const [orders, canCreate, canSeeMoney] = await Promise.all([
    listOrders(principal),
    currentUserCan('order:create'),
    currentUserCan('price:view'),
  ]);
  const sorted = sortOrders(orders);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Orders</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            {canSeeMoney ? orderSummary(orders) : orderCountSentence(orders)}
          </p>
        </div>
        {canCreate ? (
          <Link
            href="/orders/new"
            className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-bold text-text-inverse hover:bg-brand-primary-hover"
          >
            Take an order
          </Link>
        ) : null}
      </div>

      {orders.length === 0 ? (
        <section className="mt-8 rounded-card border border-border-default bg-surface-card p-6">
          <p className="text-[15px] font-medium text-text-primary">No orders yet.</p>
          <p className="mt-2 text-[14px] text-text-secondary">
            An order records what a buyer asked for and what was quoted. It does not move
            anything out of the store, and it does not record money — dispatch and payment are
            separate acts, and payment is not built yet.
          </p>
        </section>
      ) : null}

      <ul className="mt-6 divide-y divide-border-default">
        {sorted.map((order) => (
          <li key={order.id} className="py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Link
                href={`/orders/${order.id}`}
                className={`text-[16px] font-semibold hover:text-brand-primary ${
                  order.state === 'CANCELLED' ? 'text-text-muted' : 'text-text-primary'
                }`}
              >
                {order.orderNumber} · {order.customerName}
              </Link>
              {canSeeMoney ? (
                <span className="tabular text-[16px] font-bold text-text-primary">
                  {formatGHS(order.totalPesewas)}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-[13.5px] text-text-secondary">
              {STATE_LABELS[order.state]}
              {order.wantedOn ? ` · wanted ${day(order.wantedOn)}` : ''}
              {order.lines.length > 0
                ? ` · ${order.lines.length} ${order.lines.length === 1 ? 'line' : 'lines'}`
                : ' · nothing on it yet'}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
