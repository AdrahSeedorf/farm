import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { outstandingOrders } from '@/lib/order-service';
import { outstandingLines } from '@/lib/purchasing';
import { whatsappLink, telLink, formatGhanaPhone } from '@/lib/ghana';

export const metadata: Metadata = { title: 'Still to come' };

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The chasing list.
 *
 * One question: what has the farm paid for, or committed to, that has not
 * turned up? Sorted by how late it is, so the order somebody should ring about
 * is at the top and the phone number to ring is on the same card.
 *
 * DRAFTS AND CANCELLED ORDERS ARE NOT HERE. A draft is not out with anybody and
 * a cancelled order is not something to chase. Putting either on this list would
 * make it long enough to stop being read, and then the one genuinely late
 * delivery goes unchased with it.
 */
export default async function OutstandingPage() {
  const { principal, allowed } = await pageGuard('procurement:view');
  if (!allowed) return <Forbidden area="ordering" roles={principal.roles} />;

  const orders = await outstandingOrders(principal);
  const late = orders.filter((o) => o.timing.status === 'LATE');

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <Link href="/purchases" className="text-[14px] font-semibold text-brand-primary">
        ← Purchases
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Still to come</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        Orders that are out with a supplier and have not fully arrived.
      </p>

      {orders.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border-strong bg-surface-card p-10 text-center">
          <h2 className="text-lg font-semibold text-text-primary">Nothing outstanding</h2>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-text-secondary">
            Every order that has been sent has arrived in full. Nothing to chase.
          </p>
        </div>
      ) : (
        <>
          <p
            className={`mt-6 rounded-control border px-4 py-3 text-[14px] ${
              late.length > 0
                ? 'border-status-attention bg-status-attention-bg font-medium text-status-attention'
                : 'border-border-default bg-surface-card text-text-secondary'
            }`}
          >
            {late.length > 0
              ? `${late.length} of ${orders.length} ${late.length === 1 ? 'is' : 'are'} past the date agreed with the supplier.`
              : `${orders.length} order${orders.length === 1 ? '' : 's'} out, none of them late.`}
          </p>

          <ul className="mt-6 space-y-3">
            {orders.map((order) => (
              <li
                key={order.id}
                className={`rounded-card border bg-surface-card p-5 ${
                  order.timing.status === 'LATE'
                    ? 'border-status-attention'
                    : 'border-border-default'
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="text-[17px] font-bold text-text-primary">
                    <Link
                      href={`/purchases/${order.id}`}
                      className="hover:text-brand-primary"
                    >
                      {order.supplierName}
                    </Link>
                  </h2>
                  <span className="font-mono text-[13px] font-semibold text-text-muted">
                    {order.orderNumber}
                  </span>
                </div>

                <p
                  className={`mt-1 text-[14px] font-medium ${
                    order.timing.status === 'LATE'
                      ? 'text-status-attention'
                      : 'text-text-secondary'
                  }`}
                >
                  {order.timingSentence}
                  {order.expectedOn ? ` Agreed for ${day(order.expectedOn)}.` : ''}
                </p>

                {/* WHAT is missing, not just that something is. The person is
                    about to ring a mill and needs to say what to send. */}
                <ul className="mt-3 space-y-1 border-t border-border-default pt-3">
                  {outstandingLines(order.lines).map((line) => (
                    <li key={line.id} className="tabular text-[14px] text-text-primary">
                      <span className="font-semibold">
                        {Math.round((line.quantityOrdered - line.quantityReceived) * 1000) /
                          1000}{' '}
                        {line.unitKey.replace(/_/g, ' ')}
                      </span>{' '}
                      {line.itemName}
                      {line.quantityReceived > 0 ? (
                        <span className="text-text-muted">
                          {' '}
                          ({line.quantityReceived} of {line.quantityOrdered} already in)
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>

                <div className="mt-4 flex flex-wrap gap-2">
                  {order.supplierPhone && telLink(order.supplierPhone) ? (
                    <a
                      href={telLink(order.supplierPhone)!}
                      className="inline-flex min-h-touch items-center rounded-control border border-border-strong px-4 text-[14px] font-semibold text-text-primary hover:bg-surface-sunken"
                    >
                      Call {formatGhanaPhone(order.supplierPhone)}
                    </a>
                  ) : null}
                  {order.supplierPhone && whatsappLink(order.supplierPhone) ? (
                    <a
                      href={whatsappLink(order.supplierPhone)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-touch items-center rounded-control border border-border-strong px-4 text-[14px] font-semibold text-text-primary hover:bg-surface-sunken"
                    >
                      WhatsApp about {order.orderNumber}
                    </a>
                  ) : null}
                  <Link
                    href={`/purchases/${order.id}/receive`}
                    className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-4 text-[14px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
                  >
                    It arrived
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
