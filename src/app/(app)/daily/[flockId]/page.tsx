import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { canAccessSite } from '@/lib/scope';
import { dailyContextFor } from '@/lib/daily-service';
import { reasonCodesFor, reasonLabel } from '@/lib/reason-codes';
import { CHICK_BEHAVIOURS, LITTER_CONDITIONS, chickBehaviour, litterCondition } from '@/lib/rearing';
import { uncostedNote } from '@/lib/feed-issue';
import { flockScheduleFor } from '@/lib/health-service';
import { flockWithdrawals } from '@/lib/withdrawal-service';
import { WithdrawalBanner } from '../../health/WithdrawalBanner';
import { scheduleSentence } from '@/lib/health-schedule';
import { formatGHS, pesewas } from '@/lib/money';
import { DailyForm } from '../DailyForm';
import { saveDailyRecord } from '../actions';

export const metadata: Metadata = { title: 'Daily record' };

export default async function DailyEntryPage({
  params,
}: {
  params: Promise<{ flockId: string }>;
}) {
  const { flockId } = await params;
  const { principal, allowed } = await pageGuard('dailyRecord:create');
  if (!allowed) return <Forbidden area="daily records" roles={principal.roles} />;

  const today = new Date();
  const onDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const context = await dailyContextFor(flockId, onDate);
  if (!context) notFound();
  if (!canAccessSite(principal, context.siteId)) notFound();

  const heading = context.houseName ?? context.code;

  /**
   * A farm worker records the feed but must never see what it cost.
   *
   * The role matrix already withholds every financial resource from them; this
   * is the same rule applied at the point of display, because a cost that leaks
   * onto the one screen a worker uses every morning makes the matrix decorative.
   */
  const canSeeCost = await currentUserCan('finance:view');

  /**
   * What this flock is due today, shown on the screen people actually open every
   * morning. A reminder that lives only on a dashboard is a reminder seen by
   * whoever looks at dashboards, which is not the person standing in the house.
   */
  const healthView = (await currentUserCan('health:view'))
    ? await flockScheduleFor(principal, flockId, onDate)
    : null;
  const healthDue =
    healthView?.schedule.filter((e) => e.status === 'DUE' || e.status === 'OVERDUE') ?? [];

  // Shown on the morning screen because that is where someone decides whether
  // today's eggs go into a crate for sale.
  const withdrawal = healthView ? await flockWithdrawals(principal, flockId, onDate) : null;

  // Already done today — show what was recorded, read-only.
  if (context.existing) {
    const e = context.existing;
    return (
      <main className="mx-auto max-w-2xl px-5 py-8">
        <Link href="/daily" className="text-[14px] font-semibold text-brand-primary">
          ← Today
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-text-primary">{heading}</h1>
        <p className="mt-1 text-[15px] text-text-secondary">
          Recorded for {onDate.toISOString().slice(0, 10)} by {e.recordedBy}
          {e.verifiedBy ? ` · verified by ${e.verifiedBy}` : ''}
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border-default bg-border-default sm:grid-cols-4">
          {[
            { label: 'Died', value: e.mortality },
            { label: 'Culled', value: e.culls },
            { label: 'Feed', value: e.feedKg == null ? '—' : `${e.feedKg} kg` },
            { label: 'Water', value: e.waterLitres == null ? '—' : `${e.waterLitres} L` },
            ...(e.broodTempC != null
              ? [{ label: 'House temp', value: `${e.broodTempC}°C` }]
              : []),
            ...(e.chickBehaviour
              ? [{ label: 'Chicks', value: chickBehaviour(e.chickBehaviour)?.label ?? '—' }]
              : []),
            ...(e.litterCondition
              ? [{ label: 'Litter', value: litterCondition(e.litterCondition)?.label ?? '—' }]
              : []),
          ].map((row) => (
            <div key={row.label} className="bg-surface-card p-4">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                {row.label}
              </dt>
              <dd className="tabular mt-1 text-2xl font-bold text-text-primary">{row.value}</dd>
            </div>
          ))}
        </dl>

        {withdrawal && withdrawal.withdrawals.length > 0 ? (
          <WithdrawalBanner
            className="mt-5"
            withdrawals={withdrawal.withdrawals}
            eggsClearOn={withdrawal.eggsClearOn}
            meatClearsOn={withdrawal.meatClearsOn}
          />
        ) : null}

        {e.feedIssue ? (
          <div className="mt-5 rounded-card border border-border-default bg-surface-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
              Taken from the store
            </p>
            <p className="mt-1.5 text-[15px] text-text-primary">
              {e.feedIssue.issuedKg} kg of {e.feedIssue.itemName}
              {e.feedIssue.batchNumbers.length > 0
                ? ` · batch ${[...new Set(e.feedIssue.batchNumbers)].join(', ')}`
                : ''}
              {canSeeCost && e.feedIssue.costPesewas !== null
                ? ` · ${formatGHS(pesewas(e.feedIssue.costPesewas))}`
                : ''}
            </p>
            {e.feedIssue.uncostedKg > 0 ? (
              <p className="mt-1.5 text-[13px] text-status-attention">
                {uncostedNote(e.feedIssue.uncostedKg, e.feedIssue.itemName)}
              </p>
            ) : null}
          </div>
        ) : null}

        {e.observations ? (
          <p className="mt-5 rounded-card border border-border-default bg-surface-card p-4 text-[15px] text-text-secondary">
            {e.observations}
          </p>
        ) : null}

        {e.warnings.length > 0 ? (
          <div className="mt-5 rounded-card border border-status-attention bg-status-attention-bg p-4">
            <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[#6B4E12]">
              Flagged at entry and confirmed
            </p>
            <ul className="mt-2 space-y-1 text-[14px] text-[#6B4E12]">
              {e.warnings.map((w) => (
                <li key={w.message}>{w.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-7 rounded-card border border-border-default bg-surface-card p-5">
          <h2 className="text-[15px] font-semibold text-text-primary">
            Something wrong with this?
          </h2>
          <p className="mt-1.5 text-[14px] text-text-secondary">
            Records are never edited or deleted — the mortality is already on the flock&apos;s
            ledger. Record a correction instead, and both entries stay visible in the timeline.
          </p>
          <Link
            href={`/flocks/${flockId}`}
            className="mt-4 inline-flex min-h-touch items-center rounded-control border border-border-strong px-4 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
          >
            Open the flock
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/daily" className="text-[14px] font-semibold text-brand-primary">
        ← Today
      </Link>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-bold text-text-primary">{heading}</h1>
        <span className="font-mono text-[13px] text-text-muted">{context.code}</span>
        {context.stageName ? (
          <span className="rounded bg-brand-primary-soft px-2 py-0.5 text-[12px] font-semibold text-brand-primary">
            {context.stageName}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-[15px] text-text-secondary">
        {context.population.toLocaleString('en-GH')} birds · day {context.ageDays} ·{' '}
        {onDate.toISOString().slice(0, 10)}
      </p>


      {withdrawal && withdrawal.withdrawals.length > 0 ? (
        <WithdrawalBanner
          className="mt-5"
          withdrawals={withdrawal.withdrawals}
          eggsClearOn={withdrawal.eggsClearOn}
          meatClearsOn={withdrawal.meatClearsOn}
        />
      ) : null}

      {healthDue.length > 0 ? (
        <div
          className={`mt-5 rounded-card border px-4 py-3.5 ${
            healthDue.some((e) => e.status === 'OVERDUE')
              ? 'border-status-critical bg-status-critical-bg'
              : 'border-status-attention bg-status-attention-bg'
          }`}
        >
          <p
            className={`text-[13px] font-semibold uppercase tracking-[0.1em] ${
              healthDue.some((e) => e.status === 'OVERDUE')
                ? 'text-status-critical'
                : 'text-status-attention'
            }`}
          >
            Due for this flock
          </p>
          <ul className="mt-1.5 space-y-1">
            {healthDue.map((e) => (
              <li
                key={e.item.id}
                className={`text-[14px] ${
                  e.status === 'OVERDUE'
                    ? 'font-medium text-status-critical'
                    : 'text-status-attention'
                }`}
              >
                {e.item.name} — {scheduleSentence(e)}
              </li>
            ))}
          </ul>
          <Link
            href={`/flocks/${flockId}/health`}
            className="mt-2 inline-block text-[13px] font-semibold text-brand-primary"
          >
            Open the schedule
          </Link>
        </div>
      ) : null}
      <div className="mt-6 rounded-card border border-border-default bg-surface-card p-5 sm:p-6">
        <DailyForm
          action={saveDailyRecord.bind(null, flockId)}
          today={onDate.toISOString().slice(0, 10)}
          idempotencyKey={randomUUID()}
          population={context.population}
          previous={
            context.previous
              ? {
                  onDate: context.previous.onDate.toISOString().slice(0, 10),
                  mortality: context.previous.mortality,
                  feedKg: context.previous.feedKg,
                  waterLitres: context.previous.waterLitres,
                }
              : null
          }
          mortalityReasons={reasonCodesFor('MORTALITY').map((r) => ({
            key: r.key,
            label: reasonLabel(r.key),
          }))}
          cullReasons={reasonCodesFor('CULL').map((r) => ({
            key: r.key,
            label: reasonLabel(r.key),
          }))}
          isBrooding={context.isBrooding}
          broodTargetC={context.broodTargetC}
          chickBehaviours={CHICK_BEHAVIOURS.map((b) => ({ key: b.key, label: b.label }))}
          litterConditions={LITTER_CONDITIONS.map((l) => ({ key: l.key, label: l.label }))}
          feedSources={context.feedSources}
        />
      </div>

      <p className="mt-5 text-[13px] text-text-muted">
        Leave anything blank that you did not measure. Blank is not the same as zero, and the
        difference matters when these numbers are compared later.
      </p>
    </main>
  );
}
