import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { listAllocations } from '@/lib/cost-service';
import { CATEGORY_LABELS } from '@/lib/flock-costing';
import { METHOD_LABELS } from '@/lib/cost-allocation';
import { formatGHS, pesewas } from '@/lib/money';

export const metadata: Metadata = { title: 'Costs' };

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function CostsPage() {
  const { principal, allowed } = await pageGuard('finance:view');
  if (!allowed) return <Forbidden area="farm costs" roles={principal.roles} />;

  const [allocations, canCreate] = await Promise.all([
    listAllocations(principal),
    currentUserCan('finance:create'),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Costs</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            Wages, bills, hire — the costs no other screen records, and how each one was
            divided between flocks.
          </p>
        </div>
        {canCreate ? (
          <Link
            href="/costs/new"
            className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
          >
            Record a cost
          </Link>
        ) : null}
      </div>

      <p className="mt-6 rounded-control border-l-2 border-brand-accent bg-surface-sunken px-4 py-3 text-[14px] text-text-secondary">
        <strong className="font-semibold text-text-primary">
          Feed and treatments are not entered here.
        </strong>{' '}
        They are charged to a flock as they leave the store, from the daily record and the
        health screen. This page is for what the farm pays that never passes through the
        store — labour above all, which is the cost most often left out and the one that
        makes a reared pullet look cheaper than it was.
      </p>

      {allocations.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border-strong bg-surface-card p-10 text-center">
          <h2 className="text-lg font-semibold text-text-primary">Nothing recorded yet</h2>
          <p className="mx-auto mt-2 max-w-lg text-[15px] text-text-secondary">
            Start with the wage bill. A month of labour spread over the flocks that were on
            the farm is usually the single largest cost after feed, and it is the one that
            never makes it into a notebook.
          </p>
          {canCreate ? (
            <Link
              href="/costs/new"
              className="mt-6 inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
            >
              Record a cost
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-border-default overflow-hidden rounded-card border border-border-default bg-surface-card">
          {allocations.map((a) => (
            <li key={a.id} className="px-4 py-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Link
                  href={`/costs/${a.id}`}
                  className="text-[16px] font-semibold text-text-primary underline-offset-2 hover:text-brand-primary hover:underline"
                >
                  {a.description}
                </Link>
                {a.reversesId ? (
                  <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    reversal
                  </span>
                ) : null}
                {a.reversedById ? (
                  <span className="rounded-full border border-status-attention px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-status-attention">
                    reversed
                  </span>
                ) : null}
                <span
                  className={`ml-auto text-[16px] font-semibold tabular-nums ${
                    a.amountPesewas < 0 ? 'text-text-muted' : 'text-text-primary'
                  }`}
                >
                  {formatGHS(pesewas(a.amountPesewas))}
                </span>
              </div>
              <p className="mt-1 text-[13px] text-text-secondary">
                {CATEGORY_LABELS[a.category]} · {day(a.incurredOn)} ·{' '}
                {a.flockCount === 1
                  ? 'one flock'
                  : `${a.flockCount} flocks, ${METHOD_LABELS[a.method].toLowerCase()}`}
                {a.reference ? ` · ${a.reference}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
