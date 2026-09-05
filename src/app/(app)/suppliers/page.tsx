import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { listSuppliers } from '@/lib/supplier-service';
import { CATEGORY_META, type ItemCategory } from '@/lib/validation/item';

export const metadata: Metadata = { title: 'Suppliers' };

/**
 * Who the farm buys from.
 *
 * Archived suppliers are shown on request rather than hidden for good. An order
 * from last season points at one, and a name nobody can look up turns readable
 * history into a puzzle.
 */
export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { principal, allowed } = await pageGuard('supplier:view');
  if (!allowed) return <Forbidden area="suppliers" roles={principal.roles} />;

  const { archived } = await searchParams;
  const showArchived = archived === '1';

  const [suppliers, canCreate] = await Promise.all([
    listSuppliers(principal, showArchived),
    currentUserCan('supplier:create'),
  ]);

  const active = suppliers.filter((s) => s.isActive);

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Suppliers</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            Who the farm buys from, how to reach them, and how long they take.
          </p>
        </div>
        {canCreate ? (
          <Link
            href="/suppliers/new"
            className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
          >
            Add supplier
          </Link>
        ) : null}
      </div>

      {suppliers.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border-strong bg-surface-card p-10 text-center">
          <h2 className="text-lg font-semibold text-text-primary">No suppliers yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-text-secondary">
            Start with the feed mill. Feed is the biggest cost on a layer farm and the one
            delivery that cannot be late, so how long that supplier takes is worth writing
            down before the first order.
          </p>
          {canCreate ? (
            <Link
              href="/suppliers/new"
              className="mt-6 inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
            >
              Add your first supplier
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {suppliers.map((supplier) => (
            <li key={supplier.id}>
              <div
                className={`h-full rounded-card border bg-surface-card p-5 ${
                  supplier.isActive ? 'border-border-default' : 'border-dashed border-border-strong'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-lg font-bold text-text-primary">
                    <Link href={`/suppliers/${supplier.id}`} className="hover:text-brand-primary">
                      {supplier.name}
                    </Link>
                  </h2>
                  <span className="rounded bg-brand-primary-soft px-2 py-0.5 font-mono text-[12px] font-semibold text-brand-primary">
                    {supplier.code}
                  </span>
                </div>

                {supplier.isActive ? null : (
                  <p className="mt-1 text-[13px] font-semibold text-text-muted">Archived</p>
                )}

                <p className="mt-1 text-[14px] text-text-secondary">
                  {supplier.place ?? 'Location not set'}
                </p>

                {supplier.supplies.length > 0 ? (
                  <p className="mt-2 text-[13px] text-text-secondary">
                    {supplier.supplies
                      .map((c) => CATEGORY_META[c as ItemCategory]?.label ?? c)
                      .join(' · ')}
                  </p>
                ) : null}

                <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-border-default pt-3 text-[13px]">
                  <div>
                    <dt className="text-text-muted">Takes</dt>
                    <dd className="tabular font-semibold text-text-primary">
                      {supplier.effectiveLeadTimeDays} day
                      {supplier.effectiveLeadTimeDays === 1 ? '' : 's'}
                      {supplier.usingFarmDefault ? (
                        <span className="ml-1 font-normal text-text-muted">
                          (farm&rsquo;s figure)
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">Phone</dt>
                    <dd className="font-semibold text-text-primary">
                      {supplier.telHref ? (
                        <a href={supplier.telHref} className="hover:text-brand-primary">
                          {supplier.phoneDisplay}
                        </a>
                      ) : (
                        (supplier.phoneDisplay ?? '—')
                      )}
                    </dd>
                  </div>
                </dl>

                {supplier.whatsappHref ? (
                  <a
                    href={supplier.whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex min-h-[36px] items-center rounded-control border border-border-strong px-3 text-[13px] font-semibold text-text-primary hover:bg-surface-sunken"
                  >
                    WhatsApp
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 text-[14px]">
        <Link
          href={showArchived ? '/suppliers' : '/suppliers?archived=1'}
          className="font-semibold text-brand-primary"
        >
          {showArchived
            ? `Hide archived suppliers (${active.length} in use)`
            : 'Show archived suppliers'}
        </Link>
      </p>
    </main>
  );
}
