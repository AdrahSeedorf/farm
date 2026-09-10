import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { pricedProducts } from '@/lib/product-service';
import { formatGHS } from '@/lib/money';

export const metadata: Metadata = { title: 'Products & prices' };

/**
 * The price list.
 *
 * GUARDED ON `product:view`, AND THE PRICES THEMSELVES ON `price:view`.
 *
 *   Two permissions on one screen, because they are two different facts. What
 *   the farm sells is not confidential; what it charges is. A storekeeper who
 *   needs to know a crate of Large exists — to pack one — has no business
 *   seeing the margin conversation, and the specification's rule that a worker
 *   sees NO financial information of any kind has to hold on the page where
 *   money is most obviously the subject.
 */
export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ inactive?: string }>;
}) {
  const { principal, allowed } = await pageGuard('product:view');
  if (!allowed) return <Forbidden area="products and prices" roles={principal.roles} />;

  const { inactive } = await searchParams;
  const includeInactive = inactive === '1';

  const [canSeePrices, canAddProduct] = await Promise.all([
    currentUserCan('price:view'),
    currentUserCan('product:create'),
  ]);

  const rows = await pricedProducts(principal, { includeInactive });
  const unpriced = rows.filter((r) => r.product.isActive && r.price === null);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Products &amp; prices</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            {rows.length === 0
              ? 'Nothing on the list yet.'
              : `${rows.length} ${rows.length === 1 ? 'product' : 'products'}.`}
            {canSeePrices && unpriced.length > 0
              ? ` ${unpriced.length} with no price — nothing can be quoted for ${unpriced.length === 1 ? 'it' : 'them'}.`
              : ''}
          </p>
        </div>
        {canAddProduct ? (
          <Link
            href="/pricing/new"
            className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-bold text-text-inverse hover:bg-brand-primary-hover"
          >
            Add a product
          </Link>
        ) : null}
      </div>

      <div className="mt-5">
        <Link
          href={includeInactive ? '/pricing' : '/pricing?inactive=1'}
          className="text-[14px] font-semibold text-brand-primary"
        >
          {includeInactive ? 'Hide what is off the list' : 'Show what is off the list'}
        </Link>
      </div>

      {rows.length === 0 ? (
        <section className="mt-8 rounded-card border border-border-default bg-surface-card p-6">
          <p className="text-[15px] font-medium text-text-primary">Nothing to sell yet.</p>
          <p className="mt-2 text-[14px] text-text-secondary">
            A product is a pack the farm sells — a crate of thirty of a given grade, or a spent
            hen. Add one here, then set what it costs.
          </p>
        </section>
      ) : null}

      <ul className="mt-6 divide-y divide-border-default">
        {rows.map(({ product, price, coming }) => (
          <li key={product.id} className="py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Link
                href={`/pricing/${product.id}`}
                className={`text-[16px] font-semibold hover:text-brand-primary ${
                  product.isActive ? 'text-text-primary' : 'text-text-muted'
                }`}
              >
                {product.name}
              </Link>

              {/* PRICES ARE NOT RENDERED AT ALL for a reader without
                  `price:view` — not blurred, not hidden by CSS. The figure
                  never reaches the page. */}
              {canSeePrices ? (
                <span
                  className={`tabular text-[16px] font-bold ${
                    price ? 'text-text-primary' : 'text-status-attention'
                  }`}
                >
                  {price ? formatGHS(price.pricePesewas) : 'No price'}
                </span>
              ) : null}
            </div>

            <p className="mt-0.5 text-[13.5px] text-text-secondary">
              {product.sku} · {product.unitsPerPack} per {product.packLabel}
              {product.gradeName ? ` · ${product.gradeName}` : ''}
              {product.isActive ? '' : ' · off the list'}
            </p>

            {canSeePrices && coming ? (
              <p className="mt-1 text-[13px] text-status-attention">
                Changing to{' '}
                {coming.pricePesewas === null
                  ? 'the list price'
                  : formatGHS(coming.pricePesewas)}{' '}
                on {coming.effectiveFrom.toISOString().slice(0, 10)}.
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {canSeePrices ? (
        <p className="mt-8 border-t border-border-default pt-4 text-[13px] text-text-muted">
          A price is never overwritten. Changing one adds a dated row, so an invoice from March
          still adds up after a rise in June — and every past order can be explained.
        </p>
      ) : null}
    </main>
  );
}
