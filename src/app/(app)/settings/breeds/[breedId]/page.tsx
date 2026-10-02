import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { breedStandardsById } from '@/lib/breed-standards-service';
import { StandardTableForm, RemoveStandardForm } from '../StandardForms';

export const metadata: Metadata = { title: 'Breed standard' };

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/**
 * One breed, its two tables, and what each one is doing.
 *
 * SAYS WHAT IS NOT BEING COMPARED, not just what is missing. "No lay curve" is a
 * fact about the database; "production is not being compared against anything,
 * week by week" is the consequence, and it is the one that makes somebody go and
 * find the guide.
 */
export default async function BreedStandardPage({
  params,
}: {
  params: Promise<{ breedId: string }>;
}) {
  const { principal, allowed } = await pageGuard('settings:view');
  if (!allowed) return <Forbidden area="settings" roles={principal.roles} />;

  const { breedId } = await params;
  const [breed, canEdit] = await Promise.all([
    breedStandardsById(principal, breedId),
    currentUserCan('settings:edit'),
  ]);
  if (!breed) notFound();

  const tables = [
    {
      kind: 'weight' as const,
      label: 'body weight table',
      title: 'Body weight',
      points: breed.weightPoints,
      range: breed.weightRange,
      source: breed.weightSource,
      loadedAt: day(breed.weightLoadedAt),
      judges: 'every weight sample, at that flock’s exact age',
      without:
        'Weight samples are recorded and shown, but nothing says whether a flock is on target or behind — which is the figure that decides whether to add light at week 15.',
    },
    {
      kind: 'lay' as const,
      label: 'lay curve',
      title: 'Lay curve',
      points: breed.layPoints,
      range: breed.layRange,
      source: breed.laySource,
      loadedAt: day(breed.layLoadedAt),
      judges: 'production, week by week',
      without:
        'The weekly production table has a “vs standard” column and it reads a dash on every row.',
    },
  ];

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/settings/breeds" className="text-[14px] font-semibold text-brand-primary">
        ← Breed standards
      </Link>

      <h1 className="mt-3 text-2xl font-bold text-text-primary">{breed.name}</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        {breed.flockCount === 0
          ? 'No flocks are on this breed, so nothing changes today — but loading the tables now means the first flock is judged from day one.'
          : `${breed.flockCount} ${
              breed.flockCount === 1 ? 'flock is' : 'flocks are'
            } on this breed and will be judged against whatever is loaded here.`}
      </p>

      <section className="mt-7 space-y-4">
        {tables.map((table) => (
          <div
            key={table.kind}
            className={`rounded-card border p-5 ${
              table.points > 0
                ? 'border-border-default bg-surface-card'
                : 'border-status-attention bg-surface-card'
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h2 className="text-[15px] font-bold text-text-primary">{table.title}</h2>
              <p
                className={`text-[13.5px] font-semibold ${
                  table.points > 0 ? 'text-text-secondary' : 'text-status-attention'
                }`}
              >
                {table.points > 0
                  ? `${table.points} points, day ${table.range!.fromDays}–${table.range!.toDays}`
                  : 'Not loaded'}
              </p>
            </div>

            <p className="mt-1 text-[13px] text-text-muted">Judges {table.judges}.</p>

            {table.points > 0 ? (
              <>
                <dl className="mt-3 space-y-0.5 text-[13.5px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-text-secondary">From</dt>
                    <dd className="text-text-primary">{table.source ?? 'not recorded'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-text-secondary">Loaded</dt>
                    <dd className="tabular-nums text-text-primary">
                      {table.loadedAt ?? 'not recorded'}
                    </dd>
                  </div>
                </dl>
                {/* OUTSIDE THE PUBLISHED RANGE THERE IS NO COMPARISON, said here
                    rather than discovered as a dash on one row of a table. */}
                <p className="mt-2 text-[13px] text-text-muted">
                  Outside day {table.range!.fromDays}–{table.range!.toDays} no comparison is
                  made — the curve is not extrapolated past what the guide printed.
                </p>
                {canEdit ? (
                  <div className="mt-2">
                    <RemoveStandardForm
                      breedId={breed.id}
                      kind={table.kind}
                      label={table.label}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-[14px] text-status-attention">{table.without}</p>
            )}
          </div>
        ))}
      </section>

      {canEdit ? (
        <section className="mt-9">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
            Paste a table
          </h2>
          <p className="mt-2 text-[13.5px] text-text-secondary">
            Saving a table replaces that one table only — loading a lay curve does not touch the
            body weight figures.
          </p>
          <div className="mt-4">
            <StandardTableForm breedId={breed.id} breedName={breed.name} />
          </div>
        </section>
      ) : null}
    </main>
  );
}
