import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { orgFilter, siteFilter } from '@/lib/scope';
import { populationsFor } from '@/lib/flock-service';
import { ageInDays, henDayProductionPct, round } from '@/lib/metrics';
import { collectionTotal } from '@/lib/production';
import { terminologyFrom, lower } from '@/lib/terminology';
import { splitIntoContainers } from '@/lib/uom';

export const metadata: Metadata = { title: 'Production' };

/**
 * The day's production, one line per house.
 *
 * Ordered so the question this screen answers comes first: which houses have
 * been collected from today, and what did they give. A flock that is not laying
 * yet still appears — it is about to be the most interesting line on the page,
 * and hiding it would mean the first egg goes unrecorded because nobody had a
 * screen to record it on.
 */
export default async function ProductionPage() {
  const { principal, allowed } = await pageGuard('production:view');
  if (!allowed) return <Forbidden area="production records" roles={principal.roles} />;

  const now = new Date();
  const onDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const flocks = await db.animalGroup.findMany({
    where: { closedAt: null, site: orgFilter(principal), ...siteFilter(principal) },
    orderBy: [{ code: 'asc' }],
    include: {
      productionUnit: { select: { name: true } },
      currentStage: { select: { name: true, isProductionStart: true } },
      speciesProfile: { select: { terminology: true } },
      productionRecords: {
        where: { onDate },
        include: { lines: { select: { productionGradeId: true, quantityBase: true } } },
      },
    },
  });

  const populations = await populationsFor(flocks.map((f) => f.id));

  const rows = flocks.map((flock) => {
    // Corrections are ordinary rows carrying negative quantities, so the day's
    // net figure needs nothing to know which rows are which.
    const total = flock.productionRecords.reduce(
      (sum, record) =>
        sum +
        collectionTotal({
          sequence: record.sequence,
          countedQuantity: record.countedBase,
          lines: record.lines.map((l) => ({
            gradeKey: l.productionGradeId,
            quantity: l.quantityBase,
          })),
        }),
      0,
    );
    const population = populations.get(flock.id) ?? 0;

    return {
      flock,
      words: terminologyFrom(flock.speciesProfile.terminology),
      population,
      total,
      collections: flock.productionRecords.length,
      henDay: henDayProductionPct(total, population, population),
      producing: flock.currentStage?.isProductionStart ?? false,
    };
  });

  const collectedFrom = rows.filter((r) => r.collections > 0).length;
  const dayTotal = rows.reduce((sum, r) => sum + r.total, 0);
  const laying = rows.filter((r) => r.producing).length;
  const crates = splitIntoContainers(dayTotal, 'crate');

  // The words come from the first flock's species. With one species on the farm
  // that is exactly right; with two it is a heading, and every row carries its
  // own words below.
  const words = rows[0]?.words ?? terminologyFrom(null);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="text-2xl font-bold text-text-primary">{words.production}</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        {onDate.toISOString().slice(0, 10)} ·{' '}
        {rows.length === 0
          ? 'No open flocks.'
          : `${dayTotal.toLocaleString('en-GH')} today from ${collectedFrom} of ${laying} laying ${
              laying === 1 ? 'house' : 'houses'
            }`}
        {dayTotal > 0 ? ` · ${crates.containers} crates${crates.remainder > 0 ? ` and ${crates.remainder}` : ''}` : ''}
      </p>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border-strong bg-surface-card p-10 text-center">
          <h2 className="text-lg font-semibold text-text-primary">Nothing to record yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-text-secondary">
            Collections belong to a flock. Place one and it will appear here.
          </p>
          <Link
            href="/flocks/new"
            className="mt-6 inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
          >
            Place a flock
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {rows.map((row) => (
            <li key={row.flock.id}>
              <Link
                href={`/production/${row.flock.id}`}
                className={`flex items-center gap-4 rounded-card border bg-surface-card p-4 transition-colors hover:bg-surface-sunken ${
                  row.producing && row.collections === 0
                    ? 'border-brand-primary'
                    : 'border-border-default'
                }`}
              >
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[17px] font-bold text-text-primary">
                      {row.flock.productionUnit?.name ?? row.flock.code}
                    </span>
                    <span className="font-mono text-[12px] text-text-muted">
                      {row.flock.code}
                    </span>
                    {row.flock.currentStage ? (
                      <span className="rounded bg-brand-primary-soft px-2 py-0.5 text-[11px] font-semibold text-brand-primary">
                        {row.flock.currentStage.name}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[13.5px] text-text-secondary">
                    {row.population.toLocaleString('en-GH')} {lower(row.words.animalPlural)} · day{' '}
                    {ageInDays(row.flock.dateOfHatch, onDate)}
                    {row.collections > 0
                      ? ` · ${row.collections} collection${row.collections === 1 ? '' : 's'}`
                      : ''}
                  </p>
                </div>

                <div className="text-right">
                  <div className="tabular text-[22px] font-bold text-text-primary">
                    {row.collections === 0 ? '—' : row.total.toLocaleString('en-GH')}
                  </div>
                  <div className="text-[12px] text-text-muted">
                    {row.collections === 0
                      ? row.producing
                        ? 'not collected'
                        : 'not laying yet'
                      : row.henDay === null
                        ? ''
                        : `${round(row.henDay, 1)}% lay`}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
