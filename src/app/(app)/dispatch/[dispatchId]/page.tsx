import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { db } from '@/lib/db';
import { dispatchById } from '@/lib/dispatch-service';
import { baseUnitsOf, isLive, reversalSentence, METHOD_LABELS } from '@/lib/dispatch';
import { ReverseLoadForm } from '../DispatchForms';

export const metadata: Metadata = { title: 'Load' };

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function DispatchDetailPage({
  params,
}: {
  params: Promise<{ dispatchId: string }>;
}) {
  const { principal, allowed } = await pageGuard('delivery:view');
  if (!allowed) return <Forbidden area="loads" roles={principal.roles} />;

  const { dispatchId } = await params;
  const [dispatch, canReverse] = await Promise.all([
    dispatchById(principal, dispatchId),
    currentUserCan('delivery:edit'),
  ]);
  if (!dispatch) notFound();

  /**
   * The stock outcome per line, read straight from the rows the service wrote.
   *
   * Kept on the page rather than folded into the Dispatch shape because it is
   * bookkeeping about the store, not a fact about the load — and only this
   * screen has any business showing it.
   */
  const stockLines = await db.dispatchLine.findMany({
    where: { dispatchId: dispatch.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      stockMovedBase: true,
      stockShortfallBase: true,
      stockReason: true,
    },
  });
  const stockById = new Map(stockLines.map((l) => [l.id, l]));

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/dispatch" className="text-[14px] font-semibold text-brand-primary">
        ← Loads out
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{dispatch.reference}</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            <Link
              href={`/orders/${dispatch.salesOrderId}`}
              className="font-semibold text-brand-primary hover:underline"
            >
              {dispatch.orderNumber}
            </Link>
            {' · '}
            {dispatch.customerName}
          </p>
          <p className="mt-0.5 text-[13.5px] text-text-muted">
            {METHOD_LABELS[dispatch.method]} · {day(dispatch.dispatchedOn)}
            {dispatch.recordedByName ? ` · recorded by ${dispatch.recordedByName}` : ''}
          </p>
        </div>
        <span className="tabular text-[24px] font-bold text-text-primary">
          {baseUnitsOf(dispatch.lines)}
        </span>
      </div>

      {isLive(dispatch) ? null : (
        <p
          role="status"
          className="mt-5 rounded-control border border-border-strong bg-surface-sunken px-4 py-3 text-[14px] text-text-primary"
        >
          {reversalSentence(dispatch)} The stock went back to the store.
        </p>
      )}

      <section className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
          What went out
        </h2>
        <ul className="mt-3 divide-y divide-border-default">
          {dispatch.lines.map((line) => {
            const stock = stockById.get(line.id);
            return (
              <li key={line.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-[15px] font-semibold text-text-primary">
                    {line.quantity} {line.packLabel}
                    {line.quantity === 1 ? '' : 's'} · {line.productName}
                  </span>
                  <span className="tabular text-[15px] font-bold text-text-primary">
                    {line.quantity * line.unitsPerPack}
                  </span>
                </div>
                {stock?.stockReason ? (
                  <p className="mt-0.5 text-[13px] text-text-muted">{stock.stockReason}</p>
                ) : (
                  <p className="mt-0.5 text-[13px] text-text-muted">
                    {stock?.stockMovedBase ?? 0} came off the store.
                  </p>
                )}
                {/* THE GAP BETWEEN THE SHELF AND THE RECORD, said plainly. */}
                {stock && stock.stockShortfallBase > 0 ? (
                  <p className="mt-1 rounded-control border border-status-attention bg-status-attention-bg px-3 py-2 text-[13px] text-status-attention">
                    The store could not account for {stock.stockShortfallBase} of these. They went
                    out anyway — that gap usually means a collection was never recorded. Check the
                    production records around {day(dispatch.dispatchedOn)}.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {dispatch.takenBy || dispatch.vehicle || dispatch.receivedBy || dispatch.notes ? (
        <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
            Who and how
          </h2>
          <dl className="mt-3 space-y-2 text-[14px]">
            {dispatch.takenBy ? (
              <div className="flex gap-2">
                <dt className="text-text-secondary">Taken by</dt>
                <dd className="font-medium text-text-primary">{dispatch.takenBy}</dd>
              </div>
            ) : null}
            {dispatch.vehicle ? (
              <div className="flex gap-2">
                <dt className="text-text-secondary">Vehicle</dt>
                <dd className="font-medium text-text-primary">{dispatch.vehicle}</dd>
              </div>
            ) : null}
            {dispatch.receivedBy ? (
              <div className="flex gap-2">
                <dt className="text-text-secondary">Received by</dt>
                <dd className="font-medium text-text-primary">{dispatch.receivedBy}</dd>
              </div>
            ) : null}
            {dispatch.notes ? (
              <div className="flex gap-2">
                <dt className="text-text-secondary">Notes</dt>
                <dd className="text-text-primary">{dispatch.notes}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      <section className="mt-8 rounded-card border border-border-default bg-surface-sunken p-6">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-text-muted">
          What this does not do
        </h2>
        <p className="mt-2 text-[14px] text-text-secondary">
          A load is not an invoice and not a payment. It says what left the farm and takes it off
          the store — nothing more. How money arrives has not been decided, so there is
          deliberately nowhere to record it yet.
        </p>
      </section>

      {canReverse && isLive(dispatch) ? (
        <div className="mt-8 border-t border-border-default pt-5">
          <ReverseLoadForm dispatchId={dispatch.id} />
        </div>
      ) : null}
    </main>
  );
}
