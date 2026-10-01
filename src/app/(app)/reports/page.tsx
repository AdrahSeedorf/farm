import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { figuresFor, produceStoreNames } from '@/lib/period-report-service';
import {
  PERIODS,
  periodFor,
  daysIn,
  periodSentence,
  isInFuture,
  reconcile,
  derive,
  headline,
  agreedSentence,
  lossSentence,
  stockTakeNote,
  BASIS,
  type PeriodKey,
} from '@/lib/period-report';
import { lastCountedByLocation } from '@/lib/stock-take-service';
import { formatGHS } from '@/lib/money';
import { PeriodPicker } from './PeriodPicker';

export const metadata: Metadata = { title: 'Report' };

/**
 * The period report.
 *
 * THE RECONCILIATION IS THE HEADLINE, not a footnote. Everything above it is
 * figures a farm could get from a notebook; the thing only this system can do is
 * check three separate ledgers against each other and say where they disagree.
 *
 * MONEY IS GATED ON `price:view`, like everywhere else. A supervisor holds
 * `report:view` and no price permission — they get the production and bird
 * figures, which is what their job needs, and no cedi figure reaches the markup.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { principal, allowed } = await pageGuard('report:view');
  if (!allowed) return <Forbidden area="reports" roles={principal.roles} />;

  const params = await searchParams;
  const key: PeriodKey = (PERIODS as readonly string[]).includes(params.period ?? '')
    ? (params.period as PeriodKey)
    : 'THIS_WEEK';

  const custom =
    params.from && params.to
      ? {
          from: new Date(`${params.from}T00:00:00.000Z`),
          to: new Date(`${params.to}T00:00:00.000Z`),
        }
      : undefined;
  const valid = custom && !Number.isNaN(custom.from.getTime()) && !Number.isNaN(custom.to.getTime());

  const today = new Date();
  const period = periodFor(key, today, valid ? custom : undefined);

  const [figures, canSeeMoney, stores, counts] = await Promise.all([
    figuresFor(principal, period),
    currentUserCan('price:view'),
    produceStoreNames(principal),
    lastCountedByLocation(principal),
  ]);

  // The most recent count across any store this person can see. The note below
  // speaks about whether the shelf has EVER been checked, not about one building.
  const lastCounted = counts
    .map((c) => c.lastCountedOn)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const derived = derive(figures, daysIn(period));
  const check = reconcile(figures);
  const future = isInFuture(period, today);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="text-2xl font-bold text-text-primary">Report</h1>
      <p className="mt-1 text-[15px] text-text-secondary">{periodSentence(period)}</p>

      <div className="mt-6">
        <Suspense fallback={null}>
          <PeriodPicker current={key} />
        </Suspense>
      </div>

      {future ? (
        <p className="mt-7 rounded-control border border-border-strong bg-surface-sunken px-4 py-3 text-[14px] text-text-primary">
          That period has not happened yet.
        </p>
      ) : (
        <>
          <p className="mt-7 text-[17px] font-semibold text-text-primary">
            {headline(figures, derived)}
          </p>

          {/* THE RECONCILIATION. High on the page, because it is the only thing
              here that a notebook cannot tell the farm. */}
          <section
            role={check.verdict === 'DISAGREES' ? 'alert' : undefined}
            className={`mt-5 rounded-card border p-6 ${
              check.verdict === 'DISAGREES'
                ? 'border-status-attention bg-status-attention-bg'
                : 'border-border-default bg-surface-card'
            }`}
          >
            <h2
              className={`text-[12px] font-semibold uppercase tracking-[0.14em] ${
                check.verdict === 'DISAGREES' ? 'text-status-attention' : 'text-brand-accent'
              }`}
            >
              Do the records agree?
            </h2>
            <p
              className={`mt-2 text-[15px] font-medium ${
                check.verdict === 'DISAGREES' ? 'text-status-attention' : 'text-text-primary'
              }`}
            >
              {check.sentence}
            </p>
            {check.verdict !== 'NOTHING_TO_CHECK' ? (
              <dl className="mt-4 space-y-1.5 text-[13.5px] text-text-secondary">
                <div className="flex justify-between gap-3">
                  <dt>Counted in the houses, in grades held as stock</dt>
                  <dd className="tabular font-semibold text-text-primary">
                    {check.countedInHouses}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Reached the store</dt>
                  <dd className="tabular font-semibold text-text-primary">{check.reachedStore}</dd>
                </div>
                {check.notHeldAsStock > 0 ? (
                  <div className="flex justify-between gap-3">
                    {/* EXPLAINED, NOT A GAP. Cracked and floor eggs are counted
                        and held by nobody. */}
                    <dt>Also collected, in grades nobody holds as stock</dt>
                    <dd className="tabular font-semibold text-text-primary">
                      {check.notHeldAsStock}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}

            {/* WHAT THIS CANNOT TELL ANYBODY, said every time. */}
            <p className="mt-4 border-t border-border-default pt-3 text-[13px] text-text-muted">
              {stockTakeNote(lastCounted, today)}{' '}
              <Link href="/inventory/counts" className="font-semibold text-brand-primary">
                Stock counts
              </Link>
            </p>
            {stores.length === 0 ? (
              <p className="mt-3 text-[13px] text-text-muted">
                No store at this farm is set to receive produce, so nothing can be checked against
                the collections. Store → Stores.
              </p>
            ) : null}
          </section>

          <Block
            title="What was collected"
            rows={[
              { label: 'Eggs collected', value: figures.collected, basis: BASIS.collected },
              { label: 'Saleable', value: figures.saleable, basis: BASIS.saleable },
              {
                label: 'Saleable rate',
                value: derived.saleablePct === null ? '—' : `${derived.saleablePct}%`,
              },
              {
                label: 'Hen-day production',
                value: derived.henDayPct === null ? '—' : `${derived.henDayPct}%`,
                note: 'Eggs a day as a share of the birds actually there.',
              },
            ]}
          />

          <Block
            title="What went out"
            rows={[
              { label: 'Loads', value: figures.loads, basis: BASIS.dispatched },
              { label: 'Eggs sold', value: figures.dispatched, basis: BASIS.dispatched },
              {
                label: 'Collected but not sold',
                value: derived.unsold,
                note: 'Not a failure — eggs collected in this period that have not gone out in it.',
              },
              ...(canSeeMoney
                ? [
                    {
                      label: 'Agreed',
                      value: formatGHS(figures.agreedPesewas),
                      basis: BASIS.agreed,
                    },
                  ]
                : []),
            ]}
            footer={canSeeMoney ? agreedSentence(figures) : undefined}
          />

          <Block
            title="The store"
            rows={[
              { label: 'Held before the period', value: figures.openingStock, basis: BASIS.stock },
              { label: 'In', value: figures.intoStore, basis: BASIS.intoStore },
              { label: 'Out', value: figures.outOfStore, basis: BASIS.outOfStore },
              { label: 'Written off', value: figures.wasted, basis: BASIS.wasted },
              { label: 'Held at the end', value: figures.closingStock, basis: BASIS.stock },
            ]}
          />

          <Block
            title="The birds"
            rows={[
              { label: 'At the start', value: figures.openingBirds, basis: BASIS.birds },
              { label: 'Died', value: figures.deaths },
              { label: 'Culled', value: figures.culls },
              { label: 'At the end', value: figures.closingBirds, basis: BASIS.birds },
            ]}
            footer={lossSentence(figures, derived)}
          />

          <Block
            title="Feed"
            rows={[
              { label: 'Issued to houses', value: `${figures.feedKg} kg`, basis: BASIS.feed },
              {
                label: 'Per bird per day',
                value:
                  derived.feedPerBirdGrams === null ? '—' : `${derived.feedPerBirdGrams} g`,
              },
              ...(canSeeMoney
                ? [
                    { label: 'Cost', value: formatGHS(figures.feedPesewas), basis: BASIS.feed },
                    {
                      label: 'Feed cost per egg',
                      value:
                        derived.feedCostPerEgg === null
                          ? '—'
                          : formatGHS(derived.feedCostPerEgg),
                      /* SAID EVERY TIME IT IS SHOWN. A farm that reads this as the
                         full cost per egg will price below its own costs. */
                      note: 'Feed only. Not the cost of an egg — there is no labour, no share of the pullets and no depreciation in this figure.',
                    },
                  ]
                : []),
            ]}
          />

          <section className="mt-8 rounded-card border border-border-default bg-surface-sunken p-6">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              What this does not do
            </h2>
            <p className="mt-2 text-[14px] text-text-secondary">
              Every figure here is added up from the records each time this page is opened —
              there are no stored totals, which is what lets the check above be worth anything.
              None of it is money received: payments are not recorded anywhere yet.
            </p>
          </section>
        </>
      )}
    </main>
  );
}

/** One group of figures, each able to say where it came from. */
function Block({
  title,
  rows,
  footer,
}: {
  title: string;
  rows: { label: string; value: string | number; basis?: string; note?: string }[];
  footer?: string;
}) {
  return (
    <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
        {title}
      </h2>
      <dl className="mt-3 divide-y divide-border-default">
        {rows.map((row) => (
          <div key={row.label} className="py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[14.5px] text-text-secondary">{row.label}</dt>
              <dd className="tabular text-[16px] font-bold text-text-primary">{row.value}</dd>
            </div>
            {row.note ? (
              <p className="mt-0.5 text-[12.5px] text-text-muted">{row.note}</p>
            ) : null}
            {row.basis ? (
              <p className="mt-0.5 text-[12px] text-text-muted">{row.basis}</p>
            ) : null}
          </div>
        ))}
      </dl>
      {footer ? <p className="mt-3 text-[14px] text-text-secondary">{footer}</p> : null}
    </section>
  );
}
