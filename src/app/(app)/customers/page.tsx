import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { listCustomers } from '@/lib/customer-service';
import {
  sortCustomers,
  matches,
  displayName,
  isArchived,
  customerSummary,
  KIND_LABELS,
} from '@/lib/customers';
import { formatGhanaPhone } from '@/lib/brand';

export const metadata: Metadata = { title: 'Buyers' };

/**
 * Who the farm sells to.
 *
 * THE SEARCH IS A PLAIN FORM, NOT A LIVE FILTER. It is a `GET` with one input,
 * so it costs no client JavaScript, survives a page reload, and can be
 * bookmarked or sent to somebody. A live filter would need the whole list in the
 * browser, which is the wrong trade the day the list is long and the wrong trade
 * today because nothing needs it.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  const { principal, allowed } = await pageGuard('customer:view');
  if (!allowed) return <Forbidden area="buyers" roles={principal.roles} />;

  const { q, archived } = await searchParams;
  const includeArchived = archived === '1';
  const query = q ?? '';

  const [all, canAdd] = await Promise.all([
    listCustomers(principal, { includeArchived }),
    currentUserCan('customer:create'),
  ]);

  const found = sortCustomers(all.filter((c) => matches(c, query)));

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Buyers</h1>
          <p className="mt-1 text-[15px] text-text-secondary">{customerSummary(all)}</p>
        </div>
        {canAdd ? (
          <Link
            href="/customers/new"
            className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-bold text-text-inverse hover:bg-brand-primary-hover"
          >
            Add a buyer
          </Link>
        ) : null}
      </div>

      <form method="get" className="mt-6 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Name, business, town or phone"
          aria-label="Search buyers"
          className="min-h-touch min-w-[220px] flex-1 rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
        />
        {includeArchived ? <input type="hidden" name="archived" value="1" /> : null}
        <button
          type="submit"
          className="min-h-touch rounded-control border border-border-strong bg-surface-card px-4 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
        >
          Search
        </button>
        <Link
          href={includeArchived ? '/customers' : '/customers?archived=1'}
          className="text-[14px] font-semibold text-brand-primary"
        >
          {includeArchived ? 'Hide put aside' : 'Show put aside'}
        </Link>
      </form>

      {found.length === 0 ? (
        <section className="mt-8 rounded-card border border-border-default bg-surface-card p-6">
          <p className="text-[15px] font-medium text-text-primary">
            {all.length === 0 ? 'Nobody on the list yet.' : 'Nothing matches that.'}
          </p>
          <p className="mt-2 text-[14px] text-text-secondary">
            {all.length === 0 ? (
              <>
                Add a buyer here, or turn a website enquiry into one from{' '}
                <Link href="/enquiries" className="font-semibold text-brand-primary hover:underline">
                  the enquiries list
                </Link>
                .
              </>
            ) : (
              'A phone number will match however it is written — 024…, +233… or with spaces.'
            )}
          </p>
        </section>
      ) : null}

      <ul className="mt-6 divide-y divide-border-default">
        {found.map((customer) => (
          <li key={customer.id} className="py-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Link
                href={`/customers/${customer.id}`}
                className={`text-[16px] font-semibold hover:text-brand-primary ${
                  isArchived(customer) ? 'text-text-muted' : 'text-text-primary'
                }`}
              >
                {displayName(customer)}
              </Link>
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                {isArchived(customer) ? 'Put aside' : KIND_LABELS[customer.kind]}
              </span>
            </div>
            <p className="mt-0.5 text-[14px] text-text-secondary">
              {/* The standing counter row has no number and is not a person. */}
              {customer.isCounterSale
                ? 'Cash sales at the gate · nobody to ring'
                : formatGhanaPhone(customer.phone)}
              {customer.town ? ` · ${customer.town}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
