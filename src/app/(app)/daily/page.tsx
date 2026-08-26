import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { orgFilter, siteFilter } from '@/lib/scope';
import { populationsFor } from '@/lib/flock-service';
import { ageInDays } from '@/lib/metrics';
import { verifyDailyRecord } from './actions';

export const metadata: Metadata = { title: 'Today' };

/**
 * The morning round.
 *
 * One line per open flock, showing at a glance which houses have been done and
 * which still need walking. This is the first screen of the day, so it answers
 * one question before any others: what is left?
 */
export default async function DailyPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;
  const { principal, allowed } = await pageGuard('dailyRecord:view');
  if (!allowed) return <Forbidden area="daily records" roles={principal.roles} />;

  const today = new Date();
  const onDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const flocks = await db.animalGroup.findMany({
    where: { closedAt: null, site: { ...orgFilter(principal) }, ...siteFilter(principal) },
    orderBy: [{ code: 'asc' }],
    include: {
      productionUnit: { select: { name: true } },
      currentStage: { select: { name: true } },
      dailyRecords: {
        where: { onDate },
        include: { recordedBy: { select: { name: true } }, verifiedBy: { select: { name: true } } },
      },
    },
  });

  const populations = await populationsFor(flocks.map((f) => f.id));
  const canVerify = await currentUserCan('dailyRecord:approve');

  const done = flocks.filter((f) => f.dailyRecords.length > 0).length;
  const remaining = flocks.length - done;

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="text-2xl font-bold text-text-primary">Today</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        {onDate.toISOString().slice(0, 10)} ·{' '}
        {flocks.length === 0
          ? 'No open flocks.'
          : remaining === 0
            ? 'Every house recorded.'
            : `${remaining} of ${flocks.length} still to record.`}
      </p>

      {saved ? (
        <p className="mt-5 rounded-control border border-status-positive bg-brand-primary-soft px-4 py-3 text-[15px] font-medium text-brand-primary">
          Record saved.
        </p>
      ) : null}

      {flocks.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border-strong bg-surface-card p-10 text-center">
          <h2 className="text-lg font-semibold text-text-primary">Nothing to record yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-text-secondary">
            Daily records belong to a flock. Place one and it will appear here every morning.
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
          {flocks.map((flock) => {
            const record = flock.dailyRecords[0];
            const population = populations.get(flock.id) ?? 0;

            return (
              <li key={flock.id}>
                <div
                  className={`rounded-card border bg-surface-card ${
                    record ? 'border-border-default' : 'border-brand-primary'
                  }`}
                >
                  <Link
                    href={`/daily/${flock.id}`}
                    className="flex items-center gap-4 p-4 transition-colors hover:bg-surface-sunken"
                  >
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[17px] font-bold text-text-primary">
                          {flock.productionUnit?.name ?? flock.code}
                        </span>
                        <span className="font-mono text-[12px] text-text-muted">{flock.code}</span>
                        {flock.currentStage ? (
                          <span className="rounded bg-brand-primary-soft px-2 py-0.5 text-[11px] font-semibold text-brand-primary">
                            {flock.currentStage.name}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[13.5px] text-text-secondary">
                        {population.toLocaleString('en-GH')} birds · day{' '}
                        {ageInDays(flock.dateOfHatch, onDate)}
                      </p>
                    </div>

                    {record ? (
                      <span className="rounded bg-brand-primary-soft px-2.5 py-1 text-[12px] font-semibold text-brand-primary">
                        Recorded
                      </span>
                    ) : (
                      <span className="min-h-touch inline-flex items-center rounded-control bg-brand-primary px-4 text-[15px] font-semibold text-text-inverse">
                        Record
                      </span>
                    )}
                  </Link>

                  {record ? (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-default px-4 py-2.5 text-[13px] text-text-secondary">
                      <span>by {record.recordedBy.name}</span>
                      {record.verifiedBy ? (
                        <span className="text-status-positive">
                          ✓ verified by {record.verifiedBy.name}
                        </span>
                      ) : canVerify && record.recordedById !== principal.userId ? (
                        <form action={verifyDailyRecord.bind(null, record.id)}>
                          <button
                            type="submit"
                            className="min-h-[36px] rounded-control border border-border-strong px-3 text-[13px] font-semibold text-text-primary hover:bg-surface-sunken"
                          >
                            Verify
                          </button>
                        </form>
                      ) : (
                        <span className="text-text-muted">awaiting verification</span>
                      )}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
