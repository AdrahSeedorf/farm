import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { db } from '@/lib/db';
import { orgFilter, siteFilter } from '@/lib/scope';
import { sellableProducts, agreedPriceMap } from '@/lib/counter-sale-service';
import { restrictedFlocks } from '@/lib/sales-service';
import { SellForm } from './SellForm';

export const metadata: Metadata = { title: 'Sell at the gate' };

/**
 * The fast path.
 *
 * NEEDS BOTH `order:create` AND `delivery:create`, because it writes an order and
 * moves stock. A storekeeper holds the second and not the first — deliberately:
 * money changes hands here, and the price on the screen is the farm's price list
 * being applied, which is not a storekeeper's job.
 */
export default async function SellPage() {
  const { principal, allowed } = await pageGuard('order:create');
  const canDispatch = await currentUserCan('delivery:create');
  if (!allowed || !canDispatch) {
    return <Forbidden area="selling at the gate" roles={principal.roles} />;
  }

  const sites = await db.site.findMany({
    where: {
      ...orgFilter(principal),
      isActive: true,
      ...(principal.siteScope.length > 0 ? { id: { in: principal.siteScope } } : {}),
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  if (sites.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-8">
        <h1 className="text-2xl font-bold text-text-primary">Sell at the gate</h1>
        <p className="mt-3 text-[15px] text-text-secondary">
          There is no farm set up to sell from yet.
        </p>
      </main>
    );
  }

  const siteId = sites[0].id;
  const [products, customers, flocks, restricted, agreedPrices] = await Promise.all([
    sellableProducts(principal, siteId, null),
    db.customer.findMany({
      where: { ...orgFilter(principal), archivedAt: null, isCounterSale: false },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, businessName: true },
    }),
    db.animalGroup.findMany({
      where: { site: orgFilter(principal), ...siteFilter(principal), closedAt: null },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, productionUnit: { select: { name: true } } },
    }),
    restrictedFlocks(principal),
    agreedPriceMap(principal),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="text-2xl font-bold text-text-primary">Sell at the gate</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        One screen for somebody standing in front of you. It writes an ordinary order and takes
        the crates off the store, exactly as the slow way would.
      </p>

      {products.length === 0 ? (
        <section className="mt-8 rounded-card border border-border-default bg-surface-card p-6">
          <p className="text-[15px] font-medium text-text-primary">
            There is nothing to sell yet.
          </p>
          <p className="mt-2 text-[14px] text-text-secondary">
            A product is a pack the farm sells — a crate, a tray, a bird —{' '}
            <Link href="/pricing/new" className="font-semibold text-brand-primary hover:underline">
              add one
            </Link>{' '}
            and give it a price.
          </p>
        </section>
      ) : (
        <div className="mt-7">
          <SellForm
            products={products.map((p) => ({
              id: p.id,
              name: p.name,
              packLabel: p.packLabel,
              unitsPerPack: p.unitsPerPack,
              pricePesewas: p.pricePesewas,
              onHandBase: p.onHandBase,
            }))}
            customers={customers}
            sites={sites}
            flocks={flocks.map((f) => ({
              id: f.id,
              name: f.productionUnit?.name ?? f.code,
            }))}
            restrictedNames={restricted.map((r) => r.name)}
            agreedPrices={agreedPrices}
          />
        </div>
      )}

      <section className="mt-8 rounded-card border border-border-default bg-surface-sunken p-6">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-text-muted">
          What this does not do
        </h2>
        <p className="mt-2 text-[14px] text-text-secondary">
          It records what was agreed and what left. It does not record money — the buyer is
          almost certainly paying cash into somebody’s hand, and how the farm takes payment has
          not been decided, so there is deliberately nowhere honest to write it down yet.
        </p>
      </section>
    </main>
  );
}
