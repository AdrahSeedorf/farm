import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { listStockTakes, lastCountedByLocation } from '@/lib/stock-take-service';
import { lastCountedSentence } from '@/lib/stock-take';

export const metadata: Metadata = { title: 'Stock counts' };

/**
 * What has been counted, and what has not.
 *
 * THE STORES THAT HAVE NEVER BEEN COUNTED COME FIRST, because that is the fact
 * this screen exists to deliver. Every other stock figure in the system is the
 * records agreeing with the records; a store with no count against it has never
 * been checked against reality, and saying so plainly is more useful than a
 * tidy empty list.
 */
export default async function StockCountsPage() {
  const { principal, allowed } = await pageGuard('inventory:view');
  if (!allowed) return <Forbidden area="stock counts" roles={principal.roles} />;

  const [takes, locations, canCount] = await Promise.all([
    listStockTakes(principal),
    lastCountedByLocation(principal),
    currentUserCan('inventory:create'),
  ]);

  const today = new Date();

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/inventory" className="text-[14px] font-semibold text-brand-primary">
        ← Stock
      </Link>

      <h1 className="mt-3 text-2xl font-bold text-text-primary">Stock counts</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        Somebody walks into a store, counts what is there, and the ledger is corrected to match.
        Until that happens, every stock figure on every screen is the records agreeing with the
        records.
      </p>

      <section className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
          The stores
        </h2>

        {locations.length === 0 ? (
          <p className="mt-3 text-[14px] text-text-secondary">
            There are no stores set up yet. A count needs somewhere to count.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border-default">
            {locations.map((location) => (
              <li
                key={location.stockLocationId}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
              >
                <div>
                  <p className="text-[15px] font-semibold text-text-primary">
                    {location.locationName}
                  </p>
                  <p
                    className={`mt-0.5 text-[13.5px] ${
                      location.lastCountedOn ? 'text-text-muted' : 'text-status-attention'
                    }`}
                  >
                    {lastCountedSentence(location.lastCountedOn, today)}
                  </p>
                </div>
                {canCount ? (
                  <Link
                    href={`/inventory/counts/new?location=${location.stockLocationId}`}
                    className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-4 text-[14px] font-semibold text-text-primary hover:bg-surface-sunken"
                  >
                    Count it
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-7">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
          Counts already done
        </h2>

        {takes.length === 0 ? (
          <p className="mt-3 text-[14px] text-text-secondary">
            Nothing has been counted yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border-default rounded-card border border-border-default bg-surface-card">
            {takes.map((take) => (
              <li key={take.id} className="px-5 py-4">
                <Link href={`/inventory/counts/${take.id}`} className="block">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-[15px] font-semibold text-text-primary">
                      {take.reference} · {take.locationName}
                    </p>
                    <p className="text-[13px] tabular-nums text-text-muted">
                      {take.countedOn.toISOString().slice(0, 10)}
                    </p>
                  </div>
                  <p className="mt-0.5 text-[13.5px] text-text-secondary">
                    {take.countedCount} counted ·{' '}
                    {take.varianceCount === 0 ? (
                      'all agreed'
                    ) : (
                      <span className="font-semibold text-status-attention">
                        {take.varianceCount} out
                      </span>
                    )}{' '}
                    · {take.countedByName}
                  </p>
                  {take.notes ? (
                    <p className="mt-0.5 text-[13px] text-text-muted">{take.notes}</p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
