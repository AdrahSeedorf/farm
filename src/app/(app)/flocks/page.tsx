import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { orgFilter, siteFilter } from '@/lib/scope';
import { populationsFor } from '@/lib/flock-service';
import { ageInDays, ageInWeeks, cumulativeMortalityPct, round } from '@/lib/metrics';

export const metadata: Metadata = { title: 'Flocks' };

export default async function FlocksPage() {
  const { principal, allowed } = await pageGuard('flock:view');
  if (!allowed) return <Forbidden area="flocks" roles={principal.roles} />;

  const flocks = await db.animalGroup.findMany({
    where: { site: { ...orgFilter(principal) }, ...siteFilter(principal) },
    orderBy: [{ closedAt: 'asc' }, { dateOfHatch: 'desc' }],
    include: {
      site: { select: { name: true } },
      productionUnit: { select: { name: true, code: true } },
      currentStage: { select: { name: true } },
    },
  });

  // One query for every population, not one per flock.
  const populations = await populationsFor(flocks.map((f) => f.id));

  // Placed counts, also in one query.
  const placedRows = await db.animalGroupEvent.groupBy({
    by: ['animalGroupId'],
    where: {
      animalGroupId: { in: flocks.map((f) => f.id) },
      type: { in: ['PLACEMENT', 'TRANSFER_IN'] },
    },
    _sum: { delta: true },
  });
  const placed = new Map(placedRows.map((r) => [r.animalGroupId, r._sum.delta ?? 0]));

  const canCreate = await currentUserCan('flock:create');
  const today = new Date();

  const openFlocks = flocks.filter((f) => !f.closedAt);
  const totalBirds = openFlocks.reduce((sum, f) => sum + (populations.get(f.id) ?? 0), 0);

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Flocks</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            {openFlocks.length === 0
              ? 'No active flocks.'
              : `${openFlocks.length} active · ${totalBirds.toLocaleString('en-GH')} birds`}
          </p>
        </div>
        {canCreate ? (
          <Link
            href="/flocks/new"
            className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
          >
            Place a flock
          </Link>
        ) : null}
      </div>

      {flocks.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border-strong bg-surface-card p-10 text-center">
          <h2 className="text-lg font-semibold text-text-primary">No flocks yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-text-secondary">
            A flock is a batch of birds placed together and tracked through its whole life.
            Placing one records the birds you received and starts its history.
          </p>
          {canCreate ? (
            <Link
              href="/flocks/new"
              className="mt-6 inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
            >
              Place your first flock
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {flocks.map((flock) => {
            const population = populations.get(flock.id) ?? 0;
            const placedCount = placed.get(flock.id) ?? 0;
            const lost = placedCount - population;
            const mortality = cumulativeMortalityPct(lost, placedCount);
            const days = ageInDays(flock.dateOfHatch, today);

            return (
              <li key={flock.id}>
                <Link
                  href={`/flocks/${flock.id}`}
                  className="block rounded-card border border-border-default bg-surface-card p-5 transition-colors hover:border-brand-primary"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-lg font-bold text-text-primary">{flock.code}</h2>
                      {flock.currentStage ? (
                        <span className="rounded bg-brand-primary-soft px-2 py-0.5 text-[12px] font-semibold text-brand-primary">
                          {flock.currentStage.name}
                        </span>
                      ) : null}
                      {flock.closedAt ? (
                        <span className="rounded bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                          Closed
                        </span>
                      ) : null}
                    </div>
                    <span className="text-[13px] text-text-secondary">
                      {flock.productionUnit?.name ?? 'No house'} · {flock.site.name}
                    </span>
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-border-default pt-3 sm:grid-cols-4">
                    <div>
                      <dt className="text-[11px] uppercase tracking-[0.1em] text-text-muted">
                        Birds alive
                      </dt>
                      <dd className="tabular text-xl font-bold text-text-primary">
                        {population.toLocaleString('en-GH')}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-[0.1em] text-text-muted">Age</dt>
                      <dd className="tabular text-xl font-bold text-text-primary">
                        {ageInWeeks(flock.dateOfHatch, today)}
                        <span className="text-[13px] font-normal text-text-secondary"> wk</span>
                      </dd>
                      <dd className="text-[12px] text-text-muted">day {days}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-[0.1em] text-text-muted">
                        Placed
                      </dt>
                      <dd className="tabular text-xl font-bold text-text-primary">
                        {placedCount.toLocaleString('en-GH')}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-[0.1em] text-text-muted">
                        Cumulative loss
                      </dt>
                      <dd className="tabular text-xl font-bold text-text-primary">
                        {mortality === null ? '—' : `${round(mortality, 1)}%`}
                      </dd>
                      <dd className="text-[12px] text-text-muted">{lost} birds</dd>
                    </div>
                  </dl>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
