import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { listStockLocations } from '@/lib/stock-service';
import { orgFilter, siteIdFilter } from '@/lib/scope';
import { LocationForm } from './LocationForm';
import { ProduceStoreButton } from './ProduceStoreButton';

export const metadata: Metadata = { title: 'Stores' };

/**
 * Where stock physically sits.
 *
 * A store belongs to a farm, which is what makes a quantity site-scoped: the
 * catalogue is shared across the business, the kilograms are not. Most farms
 * need exactly one store and will never open this page — but a farm that keeps
 * vaccines in a fridge and feed in a shed needs to say so, because "we have 40
 * doses" is not useful if nobody knows which building they are in.
 */
export default async function StockLocationsPage() {
  const { principal, allowed } = await pageGuard('inventory:manage');
  if (!allowed) return <Forbidden area="store settings" roles={principal.roles} />;

  const [locations, sites] = await Promise.all([
    listStockLocations(principal),
    db.site.findMany({
      where: { ...orgFilter(principal), ...siteIdFilter(principal) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/inventory" className="text-[14px] font-semibold text-brand-primary">
        ← Store
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Stores</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        The physical places stock is held. Every receipt and issue names one — and one store
        per farm can be the place its produce goes when a collection is recorded.
      </p>

      <section className="mt-7">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-text-muted">
          Existing
        </h2>
        {locations.length === 0 ? (
          <p className="mt-2.5 rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-[15px] text-text-secondary">
            No stores yet. Add one below before recording stock.
          </p>
        ) : (
          <ul className="mt-2.5 divide-y divide-border-default overflow-hidden rounded-card border border-border-default bg-surface-card">
            {locations.map((location) => (
              <li key={location.id} className="px-4 py-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div>
                    <span className="text-[15px] font-semibold text-text-primary">
                      {location.name}
                    </span>
                    <span className="ml-2 font-mono text-[12px] text-text-muted">
                      {location.code}
                    </span>
                  </div>
                  <span className="text-[13px] text-text-secondary">{location.site.name}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {location.receivesProduction ? (
                    <span className="rounded-full bg-brand-primary-soft px-2.5 py-0.5 text-[12px] font-semibold text-brand-primary">
                      Produce goes here
                    </span>
                  ) : null}
                  <ProduceStoreButton
                    locationId={location.id}
                    receivesProduction={location.receivesProduction}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sites.length === 0 ? (
        <p className="mt-8 rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-[15px] text-text-secondary">
          Add a farm first — a store has to sit somewhere.
        </p>
      ) : (
        <section className="mt-8">
          <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-text-muted">
            Add a store
          </h2>
          <div className="mt-2.5 rounded-card border border-border-default bg-surface-card p-6">
            <LocationForm sites={sites} />
          </div>
        </section>
      )}
    </main>
  );
}
