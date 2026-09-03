import type { Metadata } from 'next';
import Link from 'next/link';
import { KpiTile, metric } from '@/components/ui/KpiTile';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { permissionsFor } from '@/lib/rbac';
import {
  dailyMortalityPct,
  henDayProductionPct,
  saleableRatePct,
  round,
} from '@/lib/metrics';
import { splitIntoContainers, BASE_UNIT, formatQuantity } from '@/lib/uom';
import { stockOverview } from '@/lib/stock-service';
import { dueAcrossFlocks } from '@/lib/health-service';
import { withdrawalsAcrossFlocks } from '@/lib/withdrawal-service';
import { scheduleSentence } from '@/lib/health-schedule';

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

/**
 * SAMPLE PRODUCTION FIGURES, clearly labelled as such on screen.
 *
 * The stock tiles below are now real — they read the ledger. These are not, and
 * showing a fabricated number next to a real one without saying which is which
 * is how someone ends up ordering feed against an invented figure. They are
 * replaced by real flock data at the reporting milestone.
 */
const SAMPLE = {
  openingPopulation: 1950,
  closingPopulation: 1946,
  deathsToday: 4,
  eggsCollected: 1712,
  saleableEggs: 1681,
};

export default async function DashboardPage() {
  // A farm worker has no `report:view`. That is a navigation mistake, not an
  // attack — so they get a clear message, not a 500 and not a redirect loop.
  const { principal, allowed } = await pageGuard('report:view');
  if (!allowed) return <Forbidden area="the farm dashboard" roles={principal.roles} />;

  const [canSeeFinance, canSeeStock, canSeeHealth] = await Promise.all([
    currentUserCan('finance:view'),
    currentUserCan('inventory:view'),
    currentUserCan('health:view'),
  ]);

  const healthDue = canSeeHealth ? await dueAcrossFlocks(principal) : [];
  const restricted = canSeeHealth ? await withdrawalsAcrossFlocks(principal) : [];
  const healthOverdue = healthDue.filter((d) => d.entry.status === 'OVERDUE');

  // Real figures, off the ledger. Empty for a role with no inventory access.
  const stock = canSeeStock ? await stockOverview(principal) : [];
  const tightest = [...stock]
    .filter((s) => s.daysOfCover !== null)
    .sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0))[0];
  const needsOrdering = stock.filter(
    (s) => s.urgency === 'OUT' || s.urgency === 'CRITICAL' || s.urgency === 'LOW',
  );
  const expired = stock.filter((s) => s.expired.length > 0);
  const expiring = stock.filter((s) => s.expired.length === 0 && s.expiringSoon.length > 0);

  const mortality = dailyMortalityPct(SAMPLE.deathsToday, SAMPLE.openingPopulation);
  const henDay = henDayProductionPct(
    SAMPLE.eggsCollected,
    SAMPLE.openingPopulation,
    SAMPLE.closingPopulation,
  );
  const saleable = saleableRatePct(SAMPLE.saleableEggs, SAMPLE.eggsCollected);
  const crates = splitIntoContainers(SAMPLE.eggsCollected, 'crate');

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <h1 className="text-2xl font-bold text-text-primary">Today</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        Normal is uncoloured — colour marks the exceptions only. Stock figures are live;
        the production figures are still sample data until the reporting milestone.
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
        {canSeeStock ? (
          <KpiTile
            label="Needs ordering"
            value={metric(needsOrdering.length)}
            detail={
              needsOrdering.length === 0
                ? 'Nothing inside its lead time'
                : needsOrdering
                    .slice(0, 2)
                    .map((s) => s.name)
                    .join(', ')
            }
            status={needsOrdering.length > 0 ? 'attention' : undefined}
          />
        ) : null}
        {canSeeHealth ? (
          <KpiTile
            label="Health due"
            value={metric(healthDue.length)}
            detail={
              healthDue.length === 0
                ? 'Nothing due this week'
                : healthDue
                    .slice(0, 2)
                    .map((d) => d.entry.item.name)
                    .join(', ')
            }
            status={
              healthOverdue.length > 0
                ? 'critical'
                : healthDue.length > 0
                  ? 'attention'
                  : undefined
            }
          />
        ) : null}
        {canSeeFinance ? (
          <KpiTile label="Sales today" value="GHS —" detail="Milestone 15" />
        ) : null}
      </div>

      {restricted.length > 0 ? (
        <section
          role="alert"
          className="mt-10 rounded-card border border-status-critical bg-status-critical-bg p-6"
        >
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-status-critical">
            Withdrawal periods in force
          </h2>
          <ul className="mt-3 space-y-1.5">
            {restricted.map((f) => (
              <li key={f.flockId} className="text-[15px] font-medium text-status-critical">
                <Link
                  href={`/flocks/${f.flockId}/health`}
                  className="underline underline-offset-2"
                >
                  {f.houseName ?? f.flockCode}
                </Link>
                {f.eggsClearOn
                  ? ` — no eggs sold until ${f.eggsClearOn.toISOString().slice(0, 10)}`
                  : ''}
                {f.meatClearsOn
                  ? `${f.eggsClearOn ? ';' : ' —'} no birds sold until ${f.meatClearsOn.toISOString().slice(0, 10)}`
                  : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {healthDue.length > 0 ? (
        <section className="mt-10 rounded-card border border-border-default bg-surface-card p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-accent">
              Health — due or overdue
            </h2>
            <Link href="/health" className="text-[14px] font-semibold text-brand-primary">
              Open health
            </Link>
          </div>
          <ul className="mt-4 divide-y divide-border-default">
            {healthDue.slice(0, 8).map((d) => (
              <li
                key={`${d.flockId}-${d.entry.item.id}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5"
              >
                <Link
                  href={`/flocks/${d.flockId}/health`}
                  className="text-[15px] font-semibold text-text-primary hover:text-brand-primary"
                >
                  {d.houseName ?? d.flockCode}
                </Link>
                <span className="text-[15px] text-text-primary">{d.entry.item.name}</span>
                <span
                  className={`text-[14px] ${
                    d.entry.status === 'OVERDUE'
                      ? 'font-medium text-status-critical'
                      : 'text-status-attention'
                  }`}
                >
                  {scheduleSentence(d.entry)}
                </span>
                {d.programmeStatus === 'DRAFT' ? (
                  <span className="ml-auto text-[12px] text-text-muted">
                    {d.programmeName} · not vet-reviewed
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canSeeStock && (needsOrdering.length > 0 || expired.length > 0 || expiring.length > 0) ? (
        <section className="mt-10 rounded-card border border-border-default bg-surface-card p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-accent">
              The store needs attention
            </h2>
            <Link href="/inventory" className="text-[14px] font-semibold text-brand-primary">
              Open the store
            </Link>
          </div>

          <ul className="mt-4 divide-y divide-border-default">
            {expired.map((s) => (
              <li key={`x-${s.id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                <Link
                  href={`/inventory/${s.id}`}
                  className="text-[15px] font-semibold text-text-primary hover:text-brand-primary"
                >
                  {s.name}
                </Link>
                <span className="text-[14px] font-medium text-status-critical">
                  {s.expired.length} expired batch
                  {s.expired.length === 1 ? '' : 'es'} still counted as stock
                </span>
              </li>
            ))}
            {needsOrdering.map((s) => (
              <li key={`o-${s.id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                <Link
                  href={`/inventory/${s.id}`}
                  className="text-[15px] font-semibold text-text-primary hover:text-brand-primary"
                >
                  {s.name}
                </Link>
                <span className="tabular text-[14px] text-text-secondary">
                  {formatQuantity(s.onHandBase, BASE_UNIT[s.dimension], s.unitKey)} left
                </span>
                <span
                  className={`text-[14px] ${
                    s.urgency === 'LOW' ? 'text-status-attention' : 'font-medium text-status-critical'
                  }`}
                >
                  {s.sentence}
                </span>
              </li>
            ))}
            {expiring.map((s) => (
              <li key={`e-${s.id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                <Link
                  href={`/inventory/${s.id}`}
                  className="text-[15px] font-semibold text-text-primary hover:text-brand-primary"
                >
                  {s.name}
                </Link>
                <span className="text-[14px] text-status-attention">
                  Expiring soon: {s.expiringSoon.map((b) => b.batchNumber).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
