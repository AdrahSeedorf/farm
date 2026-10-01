import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { countSheet, lastCountedByLocation } from '@/lib/stock-take-service';
import { lastCountedSentence } from '@/lib/stock-take';
import { CountSheetForm } from '../CountSheetForm';

export const metadata: Metadata = { title: 'Count a store' };

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The sheet.
 *
 * WITHOUT A STORE CHOSEN THIS IS A LIST, not an error. Somebody reaching this
 * page from a bookmark or a half-remembered link should be shown the stores,
 * not told off.
 */
export default async function NewCountPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const { principal, allowed } = await pageGuard('inventory:create');
  if (!allowed) return <Forbidden area="stock counts" roles={principal.roles} />;

  const { location } = await searchParams;
  const today = new Date();

  if (!location) {
    const locations = await lastCountedByLocation(principal);
    return (
      <main className="mx-auto max-w-3xl px-5 py-8">
        <Link href="/inventory/counts" className="text-[14px] font-semibold text-brand-primary">
          ← Stock counts
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-text-primary">Which store?</h1>
        <p className="mt-1 text-[15px] text-text-secondary">
          A count covers one store, because one person walks one building.
        </p>
        <ul className="mt-5 divide-y divide-border-default rounded-card border border-border-default bg-surface-card">
          {locations.map((l) => (
            <li key={l.stockLocationId}>
              <Link
                href={`/inventory/counts/new?location=${l.stockLocationId}`}
                className="flex min-h-touch items-center justify-between px-5 py-4 hover:bg-surface-sunken"
              >
                <span className="text-[15px] font-semibold text-text-primary">
                  {l.locationName}
                </span>
                <span className="text-[13px] text-text-muted">
                  {lastCountedSentence(l.lastCountedOn, today)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {locations.length === 0 ? (
          <p className="mt-4 text-[14px] text-text-secondary">
            There are no stores set up yet.
          </p>
        ) : null}
      </main>
    );
  }

  const sheet = await countSheet(principal, location);
  if (!sheet) notFound();

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/inventory/counts" className="text-[14px] font-semibold text-brand-primary">
        ← Stock counts
      </Link>

      <h1 className="mt-3 text-2xl font-bold text-text-primary">
        Count {sheet.locationName}
      </h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        {lastCountedSentence(sheet.lastCountedOn, today)} Saving writes a correction into the stock
        ledger for anything that does not match, with your name and the reason you give on it.
      </p>

      <div className="mt-7">
        <CountSheetForm
          stockLocationId={sheet.stockLocationId}
          locationName={sheet.locationName}
          today={day(today)}
          rows={sheet.lines.map((line) => ({
            itemId: line.itemId,
            itemName: line.itemName,
            category: line.category,
            displayUnitName: line.displayUnitName,
            expectedDisplay: line.expectedDisplay,
            lastCountedOn: line.lastCountedOn ? day(line.lastCountedOn) : null,
          }))}
        />
      </div>
    </main>
  );
}
