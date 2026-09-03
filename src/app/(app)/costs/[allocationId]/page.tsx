import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { allocationById } from '@/lib/cost-service';
import { CATEGORY_LABELS } from '@/lib/flock-costing';
import { METHOD_LABELS, METHOD_EXPLANATION, weightLabel } from '@/lib/cost-allocation';
import { formatGHS, pesewas } from '@/lib/money';
import { ReverseForm } from './ReverseForm';

export const metadata: Metadata = { title: 'Cost' };

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function AllocationPage({
  params,
}: {
  params: Promise<{ allocationId: string }>;
}) {
  const { principal, allowed } = await pageGuard('finance:view');
  if (!allowed) return <Forbidden area="farm costs" roles={principal.roles} />;

  const { allocationId } = await params;
  const allocation = await allocationById(principal, allocationId);
  if (!allocation) notFound();

  const canReverse = await currentUserCan('finance:edit');
  const total = allocation.lines.reduce((s, l) => s + l.pesewas, 0);
  const isReversal = allocation.reversesId !== null;

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/costs" className="text-[14px] font-semibold text-brand-primary">
        ← Costs
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{allocation.description}</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            {CATEGORY_LABELS[allocation.category]} · {day(allocation.incurredOn)}
            {allocation.reference ? ` · ${allocation.reference}` : ''}
          </p>
        </div>
        <p className="text-2xl font-bold tabular-nums text-text-primary">
          {formatGHS(pesewas(allocation.amountPesewas))}
        </p>
      </div>

      {allocation.reversedBy ? (
        <p
          role="status"
          className="mt-6 rounded-control border border-status-attention bg-status-attention-bg px-4 py-3 text-[14px] text-status-attention"
        >
          This cost was reversed on {day(allocation.reversedBy.createdAt)}.{' '}
          <Link
            href={`/costs/${allocation.reversedBy.id}`}
            className="font-semibold underline underline-offset-2"
          >
            See the reversal
          </Link>
          . Both entries stay on each flock&apos;s record and cancel each other out.
        </p>
      ) : null}

      {allocation.reverses ? (
        <p className="mt-6 rounded-control border border-border-default bg-surface-sunken px-4 py-3 text-[14px] text-text-secondary">
          This reverses{' '}
          <Link
            href={`/costs/${allocation.reverses.id}`}
            className="font-semibold text-brand-primary underline underline-offset-2"
          >
            {allocation.reverses.description}
          </Link>
          . It carries the exact opposite of every share that cost created.
        </p>
      ) : null}

      <section className="mt-8 rounded-card border border-border-default bg-surface-card p-5 sm:p-6">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-accent">
          How it was divided
        </h2>
        <p className="mt-2 text-[14px] text-text-secondary">
          <strong className="font-semibold text-text-primary">
            {METHOD_LABELS[allocation.method]}.
          </strong>{' '}
          {METHOD_EXPLANATION[allocation.method]}
        </p>
        {allocation.periodStart && allocation.periodEnd ? (
          <p className="mt-1.5 text-[13px] text-text-secondary">
            Covering {day(allocation.periodStart)} to {day(allocation.periodEnd)}.
          </p>
        ) : null}

        <ul className="mt-5 divide-y divide-border-default">
          {allocation.lines.map((l) => (
            <li key={l.flockId} className="flex items-baseline gap-3 py-3">
              <span className="min-w-0">
                <Link
                  href={`/flocks/${l.flockId}`}
                  className="text-[15px] font-semibold text-text-primary hover:text-brand-primary"
                >
                  {l.label}
                </Link>
                <span className="mt-0.5 block text-[13px] text-text-secondary">
                  {l.weight === null ? l.code : weightLabel(allocation.method, l.weight)}
                </span>
              </span>
              <span className="ml-auto shrink-0 text-right">
                <span className="block text-[15px] font-semibold tabular-nums text-text-primary">
                  {formatGHS(pesewas(l.pesewas))}
                </span>
                <span className="block text-[12px] tabular-nums text-text-muted">
                  {total === 0 ? '' : `${((l.pesewas / total) * 100).toFixed(1)}%`}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-3 flex items-baseline gap-3 border-t border-border-strong pt-3 text-[15px]">
          <span className="font-semibold text-text-primary">Total charged to flocks</span>
          <span className="ml-auto font-bold tabular-nums text-text-primary">
            {formatGHS(pesewas(total))}
          </span>
        </p>
        {total !== allocation.amountPesewas ? (
          <p className="mt-2 text-[13px] text-status-attention">
            That is {formatGHS(pesewas(allocation.amountPesewas - total))} less than the
            amount recorded — a flock whose share rounded to nothing carries no entry.
          </p>
        ) : null}
      </section>

      <p className="mt-6 text-[13px] text-text-muted">
        Recorded by {allocation.recordedBy.name} on {day(allocation.createdAt)}.
      </p>

      {canReverse && !allocation.reversedBy && !isReversal ? (
        <section className="mt-8 rounded-card border border-border-default bg-surface-card p-5">
          <h2 className="text-[15px] font-semibold text-text-primary">Got it wrong?</h2>
          <p className="mt-1.5 text-[14px] text-text-secondary">
            This cannot be edited, and nothing here is deleted. Reversing it writes the
            opposite of every share above, so the two cancel out and both stay on the
            record — then record the cost again correctly.
          </p>
          <div className="mt-4">
            <ReverseForm allocationId={allocation.id} />
          </div>
        </section>
      ) : null}
    </main>
  );
}
