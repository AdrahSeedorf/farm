import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { flockWithdrawals } from '@/lib/withdrawal-service';
import { WithdrawalBanner } from '../../health/WithdrawalBanner';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { orgFilter, canAccessSite } from '@/lib/scope';
import { totalsFor } from '@/lib/flock-service';
import { REASON_CODES, reasonLabel, EVENT_LABELS } from '@/lib/reason-codes';
import { ageInDays, ageInWeeks, cumulativeMortalityPct, round } from '@/lib/metrics';
import { stageDrift } from '@/lib/rearing';
import { KpiTile, metric } from '@/components/ui/KpiTile';
import { EventForm } from '../EventForm';
import { StageCard } from '../StageCard';
import { recordFlockEvent, changeStage } from '../actions';

export const metadata: Metadata = { title: 'Flock' };

export default async function FlockPage({
  params,
}: {
  params: Promise<{ flockId: string }>;
}) {
  const { flockId } = await params;
  const { principal, allowed } = await pageGuard('flock:view');
  if (!allowed) return <Forbidden area="flocks" roles={principal.roles} />;

  const flock = await db.animalGroup.findFirst({
    where: { id: flockId, site: { ...orgFilter(principal) } },
    include: {
      site: { select: { id: true, name: true } },
      productionUnit: { select: { name: true, code: true } },
      currentStage: { select: { name: true } },
      breedRef: { select: { name: true } },
      productionType: {
        select: {
          name: true,
          lifecycleStages: { orderBy: { sequence: 'asc' } },
        },
      },
    },
  });
  if (!flock) notFound();
  if (!canAccessSite(principal, flock.siteId)) notFound();

  const totals = await totalsFor(flock.id);

  const events = await db.animalGroupEvent.findMany({
    where: { animalGroupId: flock.id },
    orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
    take: 100,
    include: {
      recordedBy: { select: { name: true } },
      toStage: { select: { name: true } },
    },
  });

  const canRecord = await currentUserCan('dailyRecord:create', flock.siteId);
  const withdrawal = (await currentUserCan('health:view'))
    ? await flockWithdrawals(principal, flock.id)
    : null;
  const canEditFlock = await currentUserCan('flock:edit', flock.siteId);
  const today = new Date();
  const lost = totals.placed - totals.population;
  const mortalityPct = cumulativeMortalityPct(lost, totals.placed);

  // Does the recorded stage still match the flock's age?
  const drift = stageDrift(
    ageInDays(flock.dateOfHatch, today),
    flock.currentStageId,
    flock.productionType.lifecycleStages.map((stage) => ({
      id: stage.id,
      key: stage.key,
      name: stage.name,
      sequence: stage.sequence,
      typicalStartAgeDays: stage.typicalStartAgeDays,
      typicalEndAgeDays: stage.typicalEndAgeDays,
    })),
  );

  // Running population for each row: what the flock held immediately AFTER that
  // event. Events are newest-first, so we walk back from the current total by
  // undoing everything more recent. Written without mutation — a variable
  // reassigned across a render is a genuine hazard in React, and with at most
  // 100 rows the extra arithmetic costs nothing.
  const timeline = events.map((event, index) => ({
    event,
    populationAfter:
      totals.population - events.slice(0, index).reduce((sum, e) => sum + e.delta, 0),
  }));

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <Link href="/flocks" className="text-[14px] font-semibold text-brand-primary">
        ← Flocks
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold text-text-primary">{flock.code}</h1>
            {flock.currentStage ? (
              <span className="rounded bg-brand-primary-soft px-2 py-0.5 text-[12px] font-semibold text-brand-primary">
                {flock.currentStage.name}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[15px] text-text-secondary">
            {[
              flock.breedRef?.name,
              flock.productionUnit?.name,
              flock.site.name,
              flock.supplierName ? `from ${flock.supplierName}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <Link
          href={`/flocks/${flock.id}/health`}
          className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-4 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
        >
          Health
        </Link>
        <Link
          href={`/flocks/${flock.id}/weights`}
          className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-4 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
        >
          Weights &amp; uniformity
        </Link>
      </div>

      {withdrawal && withdrawal.withdrawals.length > 0 ? (
        <WithdrawalBanner
          className="mt-6"
          withdrawals={withdrawal.withdrawals}
          eggsClearOn={withdrawal.eggsClearOn}
          meatClearsOn={withdrawal.meatClearsOn}
        />
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Birds alive"
          value={metric(totals.population)}
          detail={`of ${metric(totals.placed)} placed`}
          formula="sum of every event on the ledger"
        />
        <KpiTile
          label="Age"
          value={`${ageInWeeks(flock.dateOfHatch, today)} wk`}
          detail={`day ${ageInDays(flock.dateOfHatch, today)}`}
        />
        <KpiTile
          label="Cumulative loss"
          value={mortalityPct === null ? '—' : `${round(mortalityPct, 1)}%`}
          detail={`${metric(totals.deaths)} died · ${metric(totals.culls)} culled`}
          formula="birds lost ÷ birds placed"
        />
        <KpiTile
          label="Sold"
          value={metric(totals.sold)}
          detail={flock.closedAt ? 'Flock closed' : 'Flock open'}
        />
      </div>

      {!flock.closedAt ? (
        <div className="mt-8">
          <StageCard
            action={changeStage.bind(null, flock.id)}
            stages={flock.productionType.lifecycleStages.map((stage) => ({
              id: stage.id,
              name: stage.name,
              sequence: stage.sequence,
            }))}
            currentStageId={flock.currentStageId}
            currentStageName={drift.current?.name ?? null}
            suggestedStageId={drift.suggested?.id ?? null}
            suggestedStageName={drift.suggested?.name ?? null}
            overdue={drift.overdue}
            daysOverdue={drift.daysOverdue}
            ageDays={ageInDays(flock.dateOfHatch, today)}
            today={today.toISOString().slice(0, 10)}
            canEdit={canEditFlock}
          />
        </div>
      ) : null}

      {canRecord && !flock.closedAt ? (
        <section className="mt-8 rounded-card border border-border-default bg-surface-card p-5">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
            Record an event
          </h2>
          <div className="mt-4">
            <EventForm
              action={recordFlockEvent.bind(null, flock.id)}
              reasons={REASON_CODES.map((r) => ({
                key: r.key,
                label: r.label,
                appliesTo: [...r.appliesTo],
              }))}
              today={today.toISOString().slice(0, 10)}
            />
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-bold text-text-primary">Timeline</h2>
        <p className="mt-1 text-[14px] text-text-secondary">
          Every event this flock has ever had, newest first. Nothing here is edited or
          deleted — corrections are added as new entries.
        </p>

        <ol className="mt-4 overflow-hidden rounded-card border border-border-default bg-surface-card">
          {timeline.map(({ event, populationAfter }, index) => (
            <li
              key={event.id}
              className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3.5 ${
                index > 0 ? 'border-t border-border-default' : ''
              }`}
            >
              <time
                dateTime={event.occurredOn.toISOString()}
                className="tabular w-[92px] shrink-0 text-[13px] text-text-muted"
              >
                {event.occurredOn.toISOString().slice(0, 10)}
              </time>

              <span className="w-[52px] shrink-0 text-[12px] text-text-muted">
                {event.ageDays !== null ? `day ${event.ageDays}` : ''}
              </span>

              <span className="font-semibold text-text-primary">
                {EVENT_LABELS[event.type]}
              </span>

              {event.delta !== 0 ? (
                <span
                  className={`tabular font-semibold ${
                    event.delta < 0 ? 'text-status-critical' : 'text-status-positive'
                  }`}
                >
                  {event.delta > 0 ? '+' : ''}
                  {event.delta.toLocaleString('en-GH')}
                </span>
              ) : null}

              {event.toStage ? (
                <span className="text-[14px] text-text-secondary">→ {event.toStage.name}</span>
              ) : null}

              {event.reasonCode ? (
                <span className="rounded bg-surface-sunken px-2 py-0.5 text-[12px] text-text-secondary">
                  {reasonLabel(event.reasonCode)}
                </span>
              ) : null}

              {event.notes ? (
                <span className="text-[13px] text-text-secondary">{event.notes}</span>
              ) : null}

              <span className="tabular ml-auto text-[13px] text-text-muted">
                {populationAfter.toLocaleString('en-GH')} birds
              </span>
              <span className="w-full text-[12px] text-text-muted sm:w-auto sm:pl-2">
                {event.recordedBy.name}
              </span>
            </li>
          ))}
        </ol>

        {events.length === 100 ? (
          <p className="mt-3 text-[13px] text-text-muted">
            Showing the most recent 100 events.
          </p>
        ) : null}
      </section>
    </main>
  );
}
