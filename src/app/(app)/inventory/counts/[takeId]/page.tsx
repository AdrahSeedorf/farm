import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { stockTakeById } from '@/lib/stock-take-service';
import { causeLabel } from '@/lib/stock-take';

export const metadata: Metadata = { title: 'What the count found' };

/**
 * One count, kept.
 *
 * THERE IS NO EDIT BUTTON AND NO DELETE BUTTON ON THIS PAGE, and their absence
 * is the feature. A count is a record of something a person did on a day; if the
 * number was wrong, the fix is to count again, and the next count corrects the
 * ledger from wherever this one left it. Letting somebody erase a count would
 * make the one record that exists to catch a problem the easiest place to make a
 * problem disappear from.
 */
export default async function StockTakePage({
  params,
}: {
  params: Promise<{ takeId: string }>;
}) {
  const { principal, allowed } = await pageGuard('inventory:view');
  if (!allowed) return <Forbidden area="stock counts" roles={principal.roles} />;

  const { takeId } = await params;
  const take = await stockTakeById(principal, takeId);
  if (!take) notFound();

  const out = take.lines.filter((l) => l.varianceBase !== 0);
  const agreed = take.lines.filter((l) => l.varianceBase === 0);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/inventory/counts" className="text-[14px] font-semibold text-brand-primary">
        ← Stock counts
      </Link>

      <h1 className="mt-3 text-2xl font-bold text-text-primary">{take.reference}</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        {take.locationName} · counted {take.countedOn.toISOString().slice(0, 10)} by{' '}
        {take.countedByName}
      </p>
      {take.notes ? (
        <p className="mt-1 text-[14px] text-text-muted">{take.notes}</p>
      ) : null}

      <p className="mt-5 rounded-control border border-border-strong bg-surface-sunken px-4 py-3 text-[14px] text-text-secondary">
        {out.length === 0
          ? `${take.lines.length} ${
              take.lines.length === 1 ? 'thing' : 'things'
            } counted, and the store agreed with the records on all of them. That is not the system being right — it is the shelf and the records happening to agree on this day, which is the only way anyone can know.`
          : `${take.lines.length} counted, ${out.length} out. The stock ledger was corrected to match the shelf, and every correction carries this count's number.`}
      </p>

      {out.length > 0 ? (
        <section className="mt-7">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-status-attention">
            What did not match
          </h2>
          <ul className="mt-3 divide-y divide-border-default rounded-card border border-status-attention bg-surface-card">
            {out.map((line) => (
              <li key={line.itemId} className="px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-[15px] font-semibold text-text-primary">{line.itemName}</p>
                  <p className="text-[15px] font-bold tabular-nums text-status-attention">
                    {line.varianceDisplay > 0 ? '+' : ''}
                    {line.varianceDisplay} {line.displayUnitName}
                  </p>
                </div>
                <p className="mt-0.5 text-[13.5px] tabular-nums text-text-secondary">
                  Counted {line.countedDisplay} · records said {line.expectedDisplay}
                </p>
                <p className="mt-1 text-[13.5px] text-text-primary">
                  {causeLabel(line.cause) ?? 'No reason recorded.'}
                </p>
                {line.note ? (
                  <p className="mt-0.5 text-[13px] text-text-muted">{line.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {agreed.length > 0 ? (
        <section className="mt-7">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
            Agreed with the records
          </h2>
          <ul className="mt-3 divide-y divide-border-default rounded-card border border-border-default bg-surface-card">
            {agreed.map((line) => (
              <li
                key={line.itemId}
                className="flex items-baseline justify-between gap-x-3 px-5 py-3"
              >
                <span className="text-[14.5px] text-text-primary">{line.itemName}</span>
                <span className="text-[14px] tabular-nums text-text-muted">
                  {line.countedDisplay} {line.displayUnitName}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-7 text-[13px] text-text-muted">
        This count cannot be edited or deleted. If a figure here is wrong, count the store again —
        the next count compares against the corrected ledger and writes its own correction, and
        both counts stay on the record.
      </p>
    </main>
  );
}
