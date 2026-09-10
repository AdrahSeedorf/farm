import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { listDispatches } from '@/lib/dispatch-service';
import {
  sortDispatches,
  dispatchSummary,
  baseUnitsOf,
  packsSentence,
  isLive,
  METHOD_LABELS,
} from '@/lib/dispatch';

export const metadata: Metadata = { title: 'Loads out' };

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * What has left the farm.
 *
 * NO MONEY ON THIS SCREEN AT ALL. A driver holds `delivery:view` and no
 * `price:view`; the store's figures are what matters here, and what a load was
 * worth is a question for the order.
 */
export default async function DispatchPage() {
  const { principal, allowed } = await pageGuard('delivery:view');
  if (!allowed) return <Forbidden area="loads" roles={principal.roles} />;

  const dispatches = await listDispatches(principal);
  const sorted = sortDispatches(dispatches);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="text-2xl font-bold text-text-primary">Loads out</h1>
      <p className="mt-1 text-[15px] text-text-secondary">{dispatchSummary(dispatches)}</p>

      {dispatches.length === 0 ? (
        <section className="mt-8 rounded-card border border-border-default bg-surface-card p-6">
          <p className="text-[15px] font-medium text-text-primary">Nothing has gone out yet.</p>
          <p className="mt-2 text-[14px] text-text-secondary">
            A load is recorded against a confirmed order, from the order’s own page. It is the
            only thing on the sales side that takes produce off the store.
          </p>
        </section>
      ) : null}

      <ul className="mt-6 divide-y divide-border-default">
        {sorted.map((dispatch) => (
          <li key={dispatch.id} className="py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Link
                href={`/dispatch/${dispatch.id}`}
                className={`text-[16px] font-semibold hover:text-brand-primary ${
                  isLive(dispatch) ? 'text-text-primary' : 'text-text-muted line-through'
                }`}
              >
                {dispatch.reference} · {dispatch.customerName}
              </Link>
              <span className="tabular text-[15px] font-bold text-text-primary">
                {baseUnitsOf(dispatch.lines)}
              </span>
            </div>
            <p className="mt-0.5 text-[13.5px] text-text-secondary">
              {day(dispatch.dispatchedOn)} · {METHOD_LABELS[dispatch.method]}
              {dispatch.takenBy ? ` · ${dispatch.takenBy}` : ''}
              {isLive(dispatch) ? '' : ' · reversed'}
            </p>
            <p className="mt-0.5 text-[13px] text-text-muted">{packsSentence(dispatch.lines)}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
