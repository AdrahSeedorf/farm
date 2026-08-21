import type { Metadata } from 'next';
import { KpiTile, metric } from '@/components/ui/KpiTile';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { permissionsFor } from '@/lib/rbac';
import {
  dailyMortalityPct,
  henDayProductionPct,
  saleableRatePct,
  daysOfFeedRemaining,
  feedIntakePerBirdGrams,
  round,
} from '@/lib/metrics';
import { splitIntoContainers } from '@/lib/uom';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * Owner dashboard.
 *
 * Figures are still computed from sample values — real flock data arrives at
 * Milestone 3. What is real here is the authorisation: this page cannot be
 * reached without `report:view`, and the finance tile below is rendered only for
 * principals holding `finance:view`, so a farm worker signing in sees the
 * operational figures and no money at all.
 */

const SAMPLE = {
  openingPopulation: 1950,
  closingPopulation: 1946,
  deathsToday: 4,
  eggsCollected: 1712,
  saleableEggs: 1681,
  feedConsumedKg: 214,
  feedOnHandKg: 1750,
};

export default async function DashboardPage() {
  // A farm worker has no `report:view`. That is a navigation mistake, not an
  // attack — so they get a clear message, not a 500 and not a redirect loop.
  const { principal, allowed } = await pageGuard('report:view');
  if (!allowed) return <Forbidden area="the farm dashboard" roles={principal.roles} />;

  const canSeeFinance = await currentUserCan('finance:view');

  const avgBirds = (SAMPLE.openingPopulation + SAMPLE.closingPopulation) / 2;
  const mortality = dailyMortalityPct(SAMPLE.deathsToday, SAMPLE.openingPopulation);
  const henDay = henDayProductionPct(
    SAMPLE.eggsCollected,
    SAMPLE.openingPopulation,
    SAMPLE.closingPopulation,
  );
  const saleable = saleableRatePct(SAMPLE.saleableEggs, SAMPLE.eggsCollected);
  const feedDays = daysOfFeedRemaining(SAMPLE.feedOnHandKg, SAMPLE.feedConsumedKg);
  const intake = feedIntakePerBirdGrams(SAMPLE.feedConsumedKg, avgBirds);
  const crates = splitIntoContainers(SAMPLE.eggsCollected, 'crate');

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <h1 className="text-2xl font-bold text-text-primary">Today</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        Normal is uncoloured — colour marks the exceptions only.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Birds alive"
          value={metric(SAMPLE.closingPopulation)}
          detail={`▼ ${SAMPLE.deathsToday} today`}
        />
        <KpiTile
          label="Mortality today"
          value={metric(SAMPLE.deathsToday)}
          detail={`${metric(round(mortality), { decimals: 2, suffix: '%' })} · normal`}
          formula="deaths ÷ opening population"
        />
        <KpiTile
          label="Eggs collected"
          value={metric(SAMPLE.eggsCollected)}
          detail={`${crates.containers} crates + ${crates.remainder}`}
        />
        <KpiTile
          label="Hen-day production"
          value={metric(round(henDay), { decimals: 1, suffix: '%' })}
          detail="share of birds present that laid"
          formula="eggs ÷ average birds alive"
        />
        <KpiTile
          label="Saleable"
          value={metric(round(saleable), { decimals: 1, suffix: '%' })}
          detail={`${metric(SAMPLE.saleableEggs)} of ${metric(SAMPLE.eggsCollected)}`}
        />
        <KpiTile
          label="Feed used today"
          value={`${metric(SAMPLE.feedConsumedKg)} kg`}
          detail={`${metric(round(intake))} g per bird`}
        />
        <KpiTile
          label="Feed cover"
          value={`${metric(round(feedDays), { decimals: 1 })} days`}
          detail="Reorder layer mash"
          status="attention"
          formula="feed on hand ÷ rolling daily use"
        />
        {canSeeFinance ? (
          <KpiTile label="Sales today" value="GHS —" detail="Milestone 15" />
        ) : null}
      </div>

      <section className="mt-10 rounded-card border border-border-default bg-surface-card p-6">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-accent">
          Your access
        </h2>
        <dl className="mt-4 grid gap-4 text-[15px] sm:grid-cols-3">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
              Roles
            </dt>
            <dd className="mt-1 text-text-primary">{principal.roles.join(', ') || '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
              Permissions
            </dt>
            <dd className="mt-1 text-text-primary">{permissionsFor(principal).size}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
              Site access
            </dt>
            <dd className="mt-1 text-text-primary">
              {principal.siteScope.length === 0 ? 'All sites' : `${principal.siteScope.length} site(s)`}
            </dd>
          </div>
        </dl>
        <p className="mt-5 border-t border-border-default pt-4 text-[13px] text-text-muted">
          Milestone 1 complete — authentication, the authorisation gate, and sign-in rate
          limiting. Next: Milestone 2, organisation and sites.
        </p>
      </section>
    </main>
  );
}
