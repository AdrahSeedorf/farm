import type { Metadata } from 'next';
import Link from 'next/link';
import { KpiTile, metric } from '@/components/ui/KpiTile';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { dailyMortalityPct, round } from '@/lib/metrics';
import { splitIntoContainers } from '@/lib/uom';
import { stockOverview } from '@/lib/stock-service';
import { productionToday } from '@/lib/production-service';
import { farmTotals } from '@/lib/flock-service';
import { alertsFor } from '@/lib/alert-service';
import { alertSummary, LEVEL_LABELS } from '@/lib/alerts';
import { lower } from '@/lib/terminology';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * The owner's morning screen.
 *
 * EVERY FIGURE ON THIS PAGE IS REAL.
 *   Until this milestone the bird count and the mortality rate were invented
 *   constants sitting beside live ones, labelled as samples. That labelling was
 *   the best available answer while the reporting layer was unbuilt and it was
 *   still the wrong shape: a farm reads the number, not the caption under it,
 *   and a fabricated figure next to a real one eventually gets acted on. They
 *   are gone. Nothing here is a placeholder; where an answer does not exist yet
 *   the tile says so instead of showing a number.
 *
 * FIGURES HERE, THINGS TO DO ON /alerts.
 *   This page used to carry its own health and stock exception lists, which
 *   became a second, slightly different copy of the alert list the moment that
 *   existed — same conditions, different wording, different ordering, no
 *   parking. Two screens disagreeing about what is wrong is worse than either.
 *   So the split is now clean: the dashboard answers "how is the farm doing",
 *   the alert list answers "what needs me", and the dashboard links to it.
 *
 * NORMAL IS UNCOLOURED. Colour marks exceptions only, so a screen with no colour
 * on it means a farm with nothing wrong — readable in half a second from across
 * a room, which is the whole design of the thing.
 */
export default async function DashboardPage() {
  // A farm worker has no `report:view`. That is a navigation mistake, not an
  // attack — so they get a clear message, not a 500 and not a redirect loop.
  const { principal, allowed } = await pageGuard('report:view');
  if (!allowed) return <Forbidden area="the farm dashboard" roles={principal.roles} />;

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [canSeeFinance, canSeeStock, canSeeFlocks] = await Promise.all([
    currentUserCan('finance:view'),
    currentUserCan('inventory:view'),
    currentUserCan('flock:view'),
  ]);

  const [totals, production, stock, alertResult] = await Promise.all([
    canSeeFlocks
      ? farmTotals(principal, now)
      : Promise.resolve({
          alive: 0,
          openingPopulation: 0,
          deathsToday: 0,
          cullsToday: 0,
          soldToday: 0,
          groups: 0,
        }),
    productionToday(principal, today),
    canSeeStock ? stockOverview(principal, now) : Promise.resolve([]),
    alertsFor(principal, now),
  ]);

  const summary = alertSummary(alertResult.alerts);
  const worstAlert = alertResult.alerts[0] ?? null;

  // NO FLOCK IS NOT ZERO BIRDS. A farm waiting on its first delivery gets a
  // dash and a sentence, not a count of nothing beside a mortality rate.
  const hasFlock = totals.groups > 0;
  const mortality = hasFlock
    ? dailyMortalityPct(totals.deathsToday, totals.openingPopulation)
    : null;
  const lostToday = totals.deathsToday + totals.cullsToday;

  const tightest = [...stock]
    .filter((s) => s.daysOfCover !== null)
    .sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0))[0];

  const crates = splitIntoContainers(production.total, 'crate');

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Today</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            Every figure here is worked out from the records as they stand now. Colour marks
            the exceptions only.
          </p>
        </div>
        <Link href="/alerts" className="text-[14px] font-semibold text-brand-primary">
          {summary.total === 0 ? 'Alerts' : `Alerts · ${summary.total}`}
        </Link>
      </div>

      {/* THE FIRST THING ON THE SCREEN IS WHAT IS WRONG, and it is one line
          naming the worst thing rather than a count. "3 alerts" is a number;
          "Layer mash has run out" is a reason to tap. */}
      <Link
        href="/alerts"
        className={`mt-6 block rounded-card border p-5 transition-colors ${
          summary.critical > 0
            ? 'border-status-critical bg-status-critical-bg hover:bg-status-critical-bg/70'
            : summary.attention > 0
              ? 'border-status-attention bg-status-attention-bg hover:bg-status-attention-bg/70'
              : 'border-border-default bg-surface-card hover:bg-surface-sunken'
        }`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span
            className={`text-[11.5px] font-semibold uppercase tracking-[0.09em] ${
              summary.critical > 0
                ? 'text-status-critical'
                : summary.attention > 0
                  ? 'text-status-attention'
                  : 'text-text-muted'
            }`}
          >
            {worstAlert ? LEVEL_LABELS[worstAlert.level] : 'Alerts'}
          </span>
          {summary.total > 1 ? (
            <span className="text-[12px] text-text-muted">
              {summary.critical > 0 ? `${summary.critical} to deal with today · ` : ''}
              {summary.total} in all
            </span>
          ) : null}
        </div>
        <p
          className={`mt-1.5 text-[17px] font-semibold ${
            summary.critical > 0
              ? 'text-status-critical'
              : summary.attention > 0
                ? 'text-status-attention'
                : 'text-text-primary'
          }`}
        >
          {summary.sentence}
        </p>
        {alertResult.failed.length > 0 ? (
          <p className="mt-1.5 text-[13px] font-medium text-status-critical">
            {alertResult.failed.length === 1 ? 'One check' : `${alertResult.failed.length} checks`}{' '}
            could not be made, so this is incomplete.
          </p>
        ) : null}
      </Link>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {canSeeFlocks ? (
          <KpiTile
            label="Birds alive"
            value={hasFlock ? metric(totals.alive) : '—'}
            detail={
              !hasFlock
                ? 'No flock placed yet'
                : lostToday === 0
                  ? 'None lost today'
                  : `▼ ${lostToday} today${
                      totals.cullsToday > 0
                        ? ` (${totals.deathsToday} died, ${totals.cullsToday} culled)`
                        : ''
                    }`
            }
            formula="every placement, death, cull, sale and transfer ever recorded, summed"
          />
        ) : null}

        {canSeeFlocks ? (
          <KpiTile
            label="Mortality today"
            value={hasFlock ? metric(totals.deathsToday) : '—'}
            detail={
              !hasFlock
                ? 'No flock placed yet'
                : mortality === null
                  ? 'No birds this morning to divide by'
                  // ROUNDED TO THE PRECISION IT IS SHOWN AT. `round` defaults
                  // to two decimal places, so rounding first and then formatting
                  // to three printed 0.130% for a figure that is 0.132% — three
                  // decimals of a two-decimal number, which is a made-up digit
                  // on a screen whose whole claim is that nothing here is made
                  // up. Daily rates on a healthy flock live in the third
                  // decimal, so three is the right precision and both ends have
                  // to agree on it.
                  : `${metric(round(mortality, 3), { decimals: 3, suffix: '%' })} of the flock`
            }
            // NOT COLOURED FROM A THRESHOLD HERE. Whether today's rate is high
            // is a judgement the alert engine makes against the figure set for
            // each flock's stage, and one flock's bad morning does not make a
            // farm-wide average that means anything. The tile reports; the alert
            // above judges.
            formula="deaths today ÷ birds alive at the start of today × 100"
          />
        ) : null}

        <KpiTile
          label={`${production.words.production} collected`}
          value={metric(production.total)}
          detail={
            production.total === 0
              ? production.laying === 0
                ? 'No house is laying yet'
                : `Nothing collected from ${production.laying} laying ${
                    production.laying === 1 ? 'house' : 'houses'
                  } yet`
              : `${crates.containers} crates${crates.remainder > 0 ? ` + ${crates.remainder}` : ''} · ${production.collectedFrom} of ${production.laying} houses`
          }
          formula="every collection recorded today, corrections included"
        />

        <KpiTile
          label="Hen-day production"
          value={
            production.henDayPct === null
              ? '—'
              : metric(round(production.henDayPct), { decimals: 1, suffix: '%' })
          }
          detail={
            production.henDayPct === null
              ? 'No laying birds to divide by'
              : 'share of birds present that laid'
          }
          formula={`${lower(production.words.production)} today ÷ birds in laying houses`}
        />

        <KpiTile
          label="Saleable"
          value={
            production.saleableRatePct === null
              ? '—'
              : metric(round(production.saleableRatePct), { decimals: 1, suffix: '%' })
          }
          detail={
            production.gradedTotal === 0
              ? 'Nothing graded today'
              : `${metric(production.gradedTotal)} graded`
          }
          formula="saleable grades ÷ everything graded × 100"
        />

        {canSeeStock ? (
          <KpiTile
            label="Tightest cover"
            value={
              tightest?.daysOfCover == null
                ? '—'
                : `${metric(round(tightest.daysOfCover), { decimals: 1 })} days`
            }
            detail={tightest ? tightest.name : 'Nothing being used yet'}
            status={
              tightest?.urgency === 'OUT' || tightest?.urgency === 'CRITICAL'
                ? 'critical'
                : tightest?.urgency === 'LOW'
                  ? 'attention'
                  : undefined
            }
            formula="stock on hand ÷ the last 7 days’ rate of use"
          />
        ) : null}

        {canSeeFinance ? (
          // AN HONEST BLANK, NOT A ZERO. Sales are not built yet; showing
          // "GHS 0" would read as a day with no sales rather than a module
          // that does not exist.
          <KpiTile label="Sales today" value="—" detail="Selling is not built yet" />
        ) : null}
      </div>

      <p className="mt-8 border-t border-border-default pt-4 text-[13px] text-text-muted">
        Bird numbers come from the population ledger — every placement, death, cull, sale and
        transfer that has ever been recorded, added up. There is no bird-count field anybody
        can type into, which is why this figure and the flock histories can never disagree.
      </p>
    </main>
  );
}
