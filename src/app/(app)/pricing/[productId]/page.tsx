import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import {
  productById,
  allPrices,
  pricableCustomers,
  saleableGrades,
} from '@/lib/product-service';
import { priceFor, nextPrice, priceBasisSentence, baseUnits } from '@/lib/pricing';
import { formatGHS } from '@/lib/money';
import { PriceForm, ActiveForm, ProductForm } from '../PricingForms';

export const metadata: Metadata = { title: 'Product' };

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { principal, allowed } = await pageGuard('product:view');
  if (!allowed) return <Forbidden area="products and prices" roles={principal.roles} />;

  const { productId } = await params;
  const { edit } = await searchParams;

  const [product, canSeePrices, canSetPrice, canEditProduct] = await Promise.all([
    productById(principal, productId),
    currentUserCan('price:view'),
    currentUserCan('price:edit'),
    currentUserCan('product:edit'),
  ]);
  if (!product) notFound();

  const [prices, customers, grades] = await Promise.all([
    canSeePrices ? allPrices(principal, { productId }) : Promise.resolve([]),
    canSetPrice ? pricableCustomers(principal) : Promise.resolve([]),
    canEditProduct ? saleableGrades(principal) : Promise.resolve([]),
  ]);

  const now = new Date();
  const listPrice = priceFor(prices, { productId, customerId: null, on: now });
  const coming = nextPrice(prices, { productId, customerId: null, on: now });
  const editing = edit === '1' && canEditProduct;

  // Buyer agreements currently in force, one row per buyer.
  const agreements = canSeePrices
    ? [...new Set(prices.filter((p) => p.customerId).map((p) => p.customerId as string))]
        .map((customerId) => ({
          customerId,
          name:
            customers.find((c) => c.id === customerId)?.businessName ??
            customers.find((c) => c.id === customerId)?.name ??
            'A buyer',
          resolved: priceFor(prices, { productId, customerId, on: now }),
        }))
        .filter((a) => a.resolved?.isCustomerPrice)
    : [];

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/pricing" className="text-[14px] font-semibold text-brand-primary">
        ← Products &amp; prices
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{product.name}</h1>
          <p className="mt-1 text-[14px] text-text-secondary">
            {product.sku} · {product.unitsPerPack} per {product.packLabel}
            {product.gradeName ? ` · from ${product.gradeName}` : ''}
            {product.isActive ? '' : ' · off the list'}
          </p>
        </div>
        {canEditProduct && !editing ? (
          <Link
            href={`/pricing/${product.id}?edit=1`}
            className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-4 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
          >
            Edit
          </Link>
        ) : null}
      </div>

      {editing ? (
        <section className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
          <ProductForm
            productId={product.id}
            grades={grades}
            defaults={{
              sku: product.sku,
              name: product.name,
              gradeId: product.gradeId ?? '',
              unitsPerPack: String(product.unitsPerPack),
              packLabel: product.packLabel,
              notes: product.notes ?? '',
            }}
          />
        </section>
      ) : null}

      {canSeePrices ? (
        <>
          <section className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
              What it costs
            </h2>
            <p
              className={`mt-3 text-[30px] font-bold tabular ${
                listPrice ? 'text-text-primary' : 'text-status-attention'
              }`}
            >
              {listPrice ? formatGHS(listPrice.pricePesewas) : 'No price'}
            </p>
            <p className="mt-1 text-[14px] text-text-secondary">
              {priceBasisSentence(listPrice)}
            </p>
            {listPrice ? (
              <p className="mt-2 text-[13.5px] text-text-muted">
                One {product.packLabel} is {baseUnits(product, 1)} — so{' '}
                {formatGHS(listPrice.pricePesewas)} for {baseUnits(product, 1)}.
              </p>
            ) : null}
            {coming ? (
              <p className="mt-3 rounded-control border border-status-attention bg-status-attention-bg px-3 py-2 text-[14px] font-medium text-status-attention">
                Changing to{' '}
                {coming.pricePesewas === null ? 'the list price' : formatGHS(coming.pricePesewas)}{' '}
                on {day(coming.effectiveFrom)}
                {coming.note ? ` — ${coming.note}` : ''}.
              </p>
            ) : null}
          </section>

          {agreements.length > 0 ? (
            <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
                Agreed with buyers
              </h2>
              <ul className="mt-3 divide-y divide-border-default">
                {agreements.map((a) => (
                  <li key={a.customerId} className="flex items-baseline justify-between gap-3 py-2.5">
                    <Link
                      href={`/customers/${a.customerId}`}
                      className="text-[15px] font-semibold text-text-primary hover:text-brand-primary"
                    >
                      {a.name}
                    </Link>
                    <span className="tabular text-[15px] font-bold text-text-primary">
                      {a.resolved ? formatGHS(a.resolved.pricePesewas) : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {canSetPrice ? (
            <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
                Set a price
              </h2>
              <div className="mt-4">
                <PriceForm
                  productId={product.id}
                  customers={customers}
                  packLabel={product.packLabel}
                />
              </div>
            </section>
          ) : null}

          <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
              Every price ever set
            </h2>
            {prices.length === 0 ? (
              <p className="mt-3 text-[14px] text-text-secondary">Nothing yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border-default">
                {prices.map((row) => (
                  <li key={row.id} className="py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-[15px] text-text-primary">
                        {row.customerId
                          ? (customers.find((c) => c.id === row.customerId)?.businessName ??
                            customers.find((c) => c.id === row.customerId)?.name ??
                            'A buyer')
                          : 'List price'}
                      </span>
                      <span className="tabular text-[15px] font-semibold text-text-primary">
                        {row.pricePesewas === null
                          ? 'back to the list price'
                          : formatGHS(row.pricePesewas)}
                      </span>
                    </div>
                    <p className="text-[13px] text-text-muted">
                      from {day(row.effectiveFrom)}
                      {row.setByName ? ` · ${row.setByName}` : ''}
                      {row.note ? ` · ${row.note}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <section className="mt-7 rounded-card border border-border-default bg-surface-sunken p-6">
          <p className="text-[15px] text-text-primary">
            Your account can see what the farm sells, but not what it charges.
          </p>
        </section>
      )}

      {product.notes ? (
        <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
            Notes
          </h2>
          <p className="mt-3 whitespace-pre-line text-[15px] text-text-primary">
            {product.notes}
          </p>
        </section>
      ) : null}

      {canEditProduct ? (
        <div className="mt-8 border-t border-border-default pt-5">
          <ActiveForm productId={product.id} isActive={product.isActive} />
          <p className="mt-2 text-[13px] text-text-muted">
            Taking a product off the list stops it being sold. Nothing is deleted — it is still
            the product on every past invoice.
          </p>
        </div>
      ) : null}
    </main>
  );
}
