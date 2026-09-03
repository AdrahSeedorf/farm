import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { canAccessSite } from '@/lib/scope';
import { productionHistoryFor } from '@/lib/production-service';
import { KpiTile, metric } from '@/components/ui/KpiTile';
import { round } from '@/lib/metrics';
import {
  henDaySeries,
  weeklyLay,
  cumulativeOutput,
  henHoused,
  layMilestones,
  gradeTotals,
  saleableRate,
  saleableOf,
  rejectedOf,
  standardHenDayAt,
  henDayVsStandardPoints,
} from '@/lib/production';
import { splitIntoContainers } from '@/lib/uom';
import { lower } from '@/lib/terminology';

export const metadata: Metadata = { title: 'Production' };

/**
 * What a flock has produced, over its whole life.
 *
 * The counterpart to the costs screen: that one answers what the flock has cost,
 * this one answers what it has given back. Every figure carries the formula it
 * came from, because a production figure a manager cannot check against their
 * own paper is a production figure they will not trust.
 */
export default async function FlockProductionPage({
  params,
}: {
  params: Promise<{ flockId: string }>;
}) {
  const { flockId } = await params;
  const { principal, allowed } = await pageGuard('production:view');
  if (!allowed) return <Forbidden area="production records" roles={principal.roles} />;

  const history = await productionHistoryFor(principal, flockId);
  if (!history) notFound();
  if (!canAccessSite(principal, history.siteId)) notFound();

  const words = history.words;
  const { days, grades, lines, standard } = history;

  const series = henDaySeries(days);
  const weeks = weeklyLay(days);
  const milestones = layMilestones(series);
  const total = cumulativeOutput(days);
  const perBirdHoused = henHoused(days, history.placed);
  const crates = splitIntoContainers(total, 'crate');

  const graded = gradeTotals(lines, grades);
  const gradedTotal = lines.reduce((sum, l) => sum + l.quantity, 0);
  const saleable = saleableOf(lines, grades);
  const rejected = rejectedOf(lines, grades);

  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <Link href={`/flocks/${flockId}`} className="text-[14px] font-semibold text-brand-primary">
        ← {history.code}
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{words.production}</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            {[history.houseName, history.breedName, `day ${history.ageDays}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <Link
          href={`/production/${flockId}`}
          className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-4 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
        >
          Record a collection
        </Link>
      </div>

      {days.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border-strong bg-surface-card p-10 text-center">
          <h2 className="text-lg font-semibold text-text-primary">
            Nothing recorded yet
          </h2>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-text-secondary">
            The curve, the milestones and the grade split all come from recorded collections.
            None of them is estimated, so until the first collection is entered there is
            genuinely nothing to show.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile
              label={`${words.production} to date`}
              value={metric(total)}
              detail={`${crates.containers.toLocaleString('en-GH')} crates${
                crates.remainder > 0 ? ` and ${crates.remainder}` : ''
              }`}
              formula="every collection recorded, corrections included"
            />
            <KpiTile
              label="Per bird housed"
              value={metric(perBirdHoused, { decimals: 1 })}
              detail={`${metric(history.placed)} placed`}
              formula={`${lower(words.production)} to date ÷ ${lower(words.animalPlural)} placed`}
            />
            <KpiTile
              label="Peak lay"
              value={
                milestones.peak === null
                  ? '—'
                  : `${round(milestones.peak.henDayPct, 1)}%`
              }
              detail={
                milestones.peak === null
                  ? 'Not reached'
                  : `on day ${milestones.peak.ageDays}`
              }
              formula="the highest hen-day figure recorded"
            />
            <KpiTile
              label="Saleable"
              value={metric(round(saleableRate(lines, grades), 1), {
                suffix: '%',
                decimals: 1,
              })}
              detail={
                gradedTotal === 0
                  ? 'Nothing graded yet'
                  : `${metric(saleable)} of ${metric(gradedTotal)} · ${metric(rejected)} rejected`
              }
              formula="saleable grades ÷ everything graded × 100"
            />
          </div>

          <section className="mt-8 rounded-card border border-border-default bg-surface-card p-5">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
              Milestones
            </h2>
            <p className="mt-2 text-[14px] text-text-secondary">
              5% is the conventional definition of the onset of lay and 50% the point a flock is
              genuinely in production. They are reporting conventions, not standards this system
              holds an opinion about.
            </p>
            <dl className="mt-4 grid gap-4 sm:grid-cols-3">
              {milestones.thresholds.map((m) => (
                <div key={m.thresholdPct}>
                  <dt className="text-[11.5px] font-semibold uppercase tracking-[0.09em] text-text-muted">
                    Reached {m.thresholdPct}% lay
                  </dt>
                  <dd className="tabular mt-1 text-[19px] font-bold text-text-primary">
                    {m.ageDays === null ? '—' : `day ${m.ageDays}`}
                    {m.ageDays === null ? null : (
                      <span className="ml-2 text-[13px] font-normal text-text-secondary">
                        week {Math.floor(m.ageDays / 7)}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
              <div>
                <dt className="text-[11.5px] font-semibold uppercase tracking-[0.09em] text-text-muted">
                  Recorded from
                </dt>
                <dd className="tabular mt-1 text-[19px] font-bold text-text-primary">
                  {firstDay.onDate.toISOString().slice(0, 10)}
                  <span className="ml-2 text-[13px] font-normal text-text-secondary">
                    to {lastDay.onDate.toISOString().slice(0, 10)}
                  </span>
                </dd>
              </div>
            </dl>
          </section>

          {history.missing.length > 0 ? (
            <p className="mt-6 rounded-control border border-status-attention bg-status-attention-bg px-4 py-3 text-[14px] text-[#6B4E12]">
              {history.missing.length} day{history.missing.length === 1 ? '' : 's'} between{' '}
              {firstDay.onDate.toISOString().slice(0, 10)} and{' '}
              {lastDay.onDate.toISOString().slice(0, 10)} have no collection recorded, so every
              total on this page is lower than the truth by whatever was collected on{' '}
              {history.missing.length === 1 ? 'that day' : 'those days'}.
            </p>
          ) : null}

          <section className="mt-8">
            <h2 className="text-lg font-bold text-text-primary">By week</h2>
            <p className="mt-1 text-[14px] text-text-secondary">
              Hen-day for a week is the week&rsquo;s {lower(words.production)} divided by its
              bird-days — not the average of the daily percentages, which would give a day with
              four hundred birds the same weight as a day with four thousand.
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[14px]">
                <thead>
                  <tr className="border-b border-border-strong text-left text-[12px] uppercase tracking-[0.08em] text-text-muted">
                    <th className="py-2 pr-3 font-semibold">Week</th>
                    <th className="py-2 pr-3 text-right font-semibold">Days</th>
                    <th className="py-2 pr-3 text-right font-semibold">{words.production}</th>
                    <th className="py-2 pr-3 text-right font-semibold">Bird-days</th>
                    <th className="py-2 pr-3 text-right font-semibold">Hen-day</th>
                    <th className="py-2 text-right font-semibold">vs standard</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week) => {
                    // The middle of the week, so a weekly figure is compared with
                    // the curve at the age it actually covers rather than at its
                    // first day.
                    const standardPct = standardHenDayAt(week.ageWeeks * 7 + 3, standard);
                    const behind = henDayVsStandardPoints(week.henDayPct, standardPct);

                    return (
                      <tr key={week.ageWeeks} className="border-b border-border-default">
                        <td className="py-2 pr-3 font-semibold text-text-primary">
                          {week.ageWeeks}
                        </td>
                        <td
                          className={`tabular py-2 pr-3 text-right ${
                            week.daysRecorded < 7 ? 'text-status-attention' : 'text-text-secondary'
                          }`}
                        >
                          {week.daysRecorded}
                        </td>
                        <td className="tabular py-2 pr-3 text-right text-text-primary">
                          {week.eggs.toLocaleString('en-GH')}
                        </td>
                        <td className="tabular py-2 pr-3 text-right text-text-secondary">
                          {Math.round(week.birdDays).toLocaleString('en-GH')}
                        </td>
                        <td className="tabular py-2 pr-3 text-right font-semibold text-text-primary">
                          {week.henDayPct === null ? '—' : `${round(week.henDayPct, 1)}%`}
                        </td>
                        <td
                          className={`tabular py-2 text-right ${
                            behind !== null && behind <= -10
                              ? 'font-semibold text-status-attention'
                              : 'text-text-secondary'
                          }`}
                        >
                          {behind === null
                            ? '—'
                            : `${behind >= 0 ? '+' : ''}${behind}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {Object.keys(standard).length === 0 ? (
              <p className="mt-3 rounded-control border border-border-default bg-surface-sunken px-3.5 py-3 text-[13px] text-text-secondary">
                No lay curve has been loaded for{' '}
                {history.breedName ?? 'this breed'}, so there is nothing to compare against and
                the column reads &mdash;. The figures come from the breeder&rsquo;s own
                management guide; a curve invented here would be a target nobody could source.
              </p>
            ) : null}
          </section>

          {gradedTotal > 0 ? (
            <section className="mt-8 rounded-card border border-border-default bg-surface-card p-5">
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
                How it has graded
              </h2>
              <ul className="mt-3 divide-y divide-border-default">
                {graded.map((g) => (
                  <li key={g.key} className="flex items-baseline gap-3 py-2">
                    <span className="text-[15px] text-text-primary">{g.name}</span>
                    {g.isSaleable ? null : (
                      <span className="text-[12px] text-text-muted">not saleable</span>
                    )}
                    <span className="tabular ml-auto text-[15px] font-semibold text-text-primary">
                      {g.quantity.toLocaleString('en-GH')}
                    </span>
                    <span className="tabular w-[56px] text-right text-[13px] text-text-muted">
                      {g.sharePct === null ? '—' : `${round(g.sharePct, 1)}%`}
                    </span>
                  </li>
                ))}
              </ul>
              {gradedTotal < total ? (
                <p className="mt-3 text-[13px] text-text-muted">
                  {(total - gradedTotal).toLocaleString('en-GH')} of the{' '}
                  {total.toLocaleString('en-GH')} recorded were counted but never graded, so the
                  shares above describe the graded part only.
                </p>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
