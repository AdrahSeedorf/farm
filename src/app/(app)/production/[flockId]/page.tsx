import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { canAccessSite } from '@/lib/scope';
import { productionContextFor } from '@/lib/production-service';
import { flockWithdrawals } from '@/lib/withdrawal-service';
import { WithdrawalBanner } from '../../health/WithdrawalBanner';
import { KpiTile, metric } from '@/components/ui/KpiTile';
import { henDayProductionPct, round } from '@/lib/metrics';
import { gradeTotals, saleableRate, henDayVsStandardPoints } from '@/lib/production';
import { splitIntoContainers } from '@/lib/uom';
import { lower } from '@/lib/terminology';
import { DISPOSITION_LABELS, DISPOSITIONS } from '@/lib/validation/production';
import { CollectionForm } from '../CollectionForm';
import { CorrectionForm } from '../CorrectionForm';
import { saveCollection } from '../actions';

export const metadata: Metadata = { title: 'Collection' };

/**
 * One flock's collections for today.
 *
 * The screen someone opens standing in the house with a tray in one hand. What
 * has already been recorded today sits above the form, because the commonest
 * mistake in multi-collection recording is entering the same walk twice.
 */
export default async function CollectionPage({
  params,
}: {
  params: Promise<{ flockId: string }>;
}) {
  const { flockId } = await params;
  const { principal, allowed } = await pageGuard('production:view');
  if (!allowed) return <Forbidden area="production records" roles={principal.roles} />;

  const now = new Date();
  const onDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const context = await productionContextFor(principal, flockId, onDate);
  if (!context) notFound();
  if (!canAccessSite(principal, context.siteId)) notFound();

  const canRecord = await currentUserCan('production:create', context.siteId);
  const canCorrect = await currentUserCan('production:edit', context.siteId);
  const withdrawal = (await currentUserCan('health:view'))
    ? await flockWithdrawals(principal, flockId, onDate)
    : null;

  const words = context.words;
  const heading = context.houseName ?? context.code;

  // Every line recorded today, so the grade split is the day's, not one walk's.
  const allLines = context.today.collections.flatMap((c) =>
    c.lines.map((l) => ({ gradeKey: l.gradeId, quantity: l.quantityBase })),
  );
  const grades = context.grades;
  const dayGrades = gradeTotals(allLines, grades);
  const dayGraded = allLines.reduce((sum, l) => sum + l.quantity, 0);

  // Opening and closing are the same figure: the day is not over, and the only
  // population that exists is the one standing now. The flock's production
  // screen computes hen-day properly once the day has closed.
  const henDay = henDayProductionPct(
    context.today.total,
    context.population,
    context.population,
  );
  const behind = henDayVsStandardPoints(henDay, context.standardHenDayPct);

  const crates = splitIntoContainers(context.today.total, 'crate');

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/production" className="text-[14px] font-semibold text-brand-primary">
        ← {words.production}
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{heading}</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            {onDate.toISOString().slice(0, 10)} · {context.code} ·{' '}
            {context.population.toLocaleString('en-GH')} {lower(words.animalPlural)} · day{' '}
            {context.ageDays}
            {context.stageName ? ` · ${context.stageName}` : ''}
          </p>
        </div>
        <Link
          href={`/flocks/${flockId}`}
          className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-4 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
        >
          {words.animalGroup}
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

      {!context.recordsProduction ? (
        <p className="mt-6 rounded-control border border-border-default bg-surface-sunken px-4 py-3 text-[15px] text-text-secondary">
          This production type does not record {lower(words.production)}. Nothing here applies to
          it.
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <KpiTile
          label={`${words.production} today`}
          value={context.today.total.toLocaleString('en-GH')}
          detail={
            crates.containers > 0
              ? `${crates.containers} crate${crates.containers === 1 ? '' : 's'}${
                  crates.remainder > 0 ? ` and ${crates.remainder}` : ''
                }`
              : `${context.today.collections.length} collection${
                  context.today.collections.length === 1 ? '' : 's'
                }`
          }
          formula="every collection recorded for today, corrections included"
        />
        <KpiTile
          label="Hen-day"
          value={metric(round(henDay, 1), { suffix: '%', decimals: 1 })}
          detail={
            context.standardHenDayPct === null
              ? 'No breed curve loaded'
              : behind === null
                ? undefined
                : `${behind >= 0 ? '+' : ''}${behind} points vs ${context.standardHenDayPct}% standard`
          }
          status={behind !== null && behind <= -10 ? 'attention' : 'normal'}
          formula={`${lower(words.production)} today ÷ ${lower(words.animalPlural)} alive × 100`}
        />
        <KpiTile
          label="Saleable"
          value={metric(round(saleableRate(allLines, grades), 1), { suffix: '%', decimals: 1 })}
          detail={
            dayGraded === 0
              ? 'Nothing graded yet today'
              : `${dayGraded.toLocaleString('en-GH')} graded`
          }
          formula="saleable grades ÷ everything graded × 100"
        />
      </div>

      {dayGraded > 0 ? (
        <section className="mt-6 rounded-card border border-border-default bg-surface-card p-5">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
            How today graded
          </h2>
          <ul className="mt-3 divide-y divide-border-default">
            {dayGrades.map((g) => (
              <li key={g.key} className="flex items-baseline gap-3 py-2">
                <span className="text-[15px] text-text-primary">{g.name}</span>
                {g.isSaleable ? null : (
                  <span className="text-[12px] text-text-muted">not saleable</span>
                )}
                <span className="tabular ml-auto text-[15px] font-semibold text-text-primary">
                  {g.quantity.toLocaleString('en-GH')}
                </span>
                <span className="tabular w-[52px] text-right text-[13px] text-text-muted">
                  {g.sharePct === null ? '—' : `${round(g.sharePct, 1)}%`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="text-lg font-bold text-text-primary">Recorded today</h2>
        {context.today.collections.length === 0 ? (
          <p className="mt-2 text-[15px] text-text-secondary">
            Nothing yet. The first collection of the day goes below.
          </p>
        ) : (
          <ol className="mt-3 overflow-hidden rounded-card border border-border-default bg-surface-card">
            {context.today.collections.map((collection, index) => (
              <li
                key={collection.id}
                className={`px-5 py-3.5 ${index > 0 ? 'border-t border-border-default' : ''}`}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="w-[92px] shrink-0 text-[13px] text-text-muted">
                    {collection.correctsId ? 'Correction' : `Collection ${collection.sequence}`}
                  </span>
                  <span
                    className={`tabular text-[17px] font-bold ${
                      (collection.countedBase ?? collection.gradedBase) < 0
                        ? 'text-status-critical'
                        : 'text-text-primary'
                    }`}
                  >
                    {(collection.countedBase ?? collection.gradedBase).toLocaleString('en-GH')}
                  </span>

                  {collection.disposition === 'SALEABLE' ? null : (
                    <span className="rounded bg-surface-sunken px-2 py-0.5 text-[12px] text-text-secondary">
                      {DISPOSITION_LABELS[
                        collection.disposition as keyof typeof DISPOSITION_LABELS
                      ] ?? collection.disposition}
                    </span>
                  )}

                  <span className="ml-auto text-[12px] text-text-muted">
                    {collection.recordedBy}
                  </span>

                  {canCorrect && !collection.correctsId && !collection.correctedById ? (
                    <CorrectionForm recordId={collection.id} sequence={collection.sequence} />
                  ) : null}
                  {collection.correctedById ? (
                    <span className="text-[12px] text-text-muted">corrected</span>
                  ) : null}
                </div>

                {collection.lines.length > 0 ? (
                  <p className="mt-1 text-[13px] text-text-secondary">
                    {collection.lines
                      .map((l) => `${l.gradeName} ${l.quantityBase.toLocaleString('en-GH')}`)
                      .join(' · ')}
                  </p>
                ) : null}

                {collection.notes ? (
                  <p className="mt-1 text-[13px] text-text-secondary">{collection.notes}</p>
                ) : null}

                {collection.warnings.length > 0 ? (
                  <ul className="mt-1 text-[12px] text-text-muted">
                    {collection.warnings.map((w) => (
                      <li key={`${w.field}-${w.message}`}>Flagged and accepted: {w.message}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {canRecord ? (
        <section className="mt-8 rounded-card border border-border-default bg-surface-card p-5">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
            Record a collection
          </h2>
          <div className="mt-4">
            <CollectionForm
              action={saveCollection.bind(null, flockId)}
              today={onDate.toISOString().slice(0, 10)}
              idempotencyKey={randomUUID()}
              sequence={context.today.nextSequence}
              population={context.population}
              words={{
                production: words.production,
                productionSingular: words.productionSingular,
                animalPlural: words.animalPlural,
              }}
              grades={grades.map((g) => ({
                id: g.id,
                name: g.name,
                isSaleable: g.isSaleable,
              }))}
              units={[
                { key: 'piece', label: lower(words.production) },
                { key: 'dozen', label: 'dozens' },
                { key: 'crate', label: 'crates of 30' },
              ]}
              // Sale is not offered at all while a withdrawal stands. The gate in
              // the service refuses it regardless — this only keeps someone from
              // being told no after they have typed everything in.
              dispositions={DISPOSITIONS.filter(
                (d) => d !== 'SALEABLE' || context.eggsClearOn === null,
              ).map((d) => ({ key: d, label: DISPOSITION_LABELS[d] }))}
              eggsClearOn={context.eggsClearOn?.toISOString().slice(0, 10) ?? null}
              previousTotal={context.previous?.total ?? null}
            />
          </div>
        </section>
      ) : null}
    </main>
  );
}
