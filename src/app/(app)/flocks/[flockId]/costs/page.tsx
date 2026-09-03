import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { orgFilter, canAccessSite } from '@/lib/scope';
import { totalsFor } from '@/lib/flock-service';
import { costEntriesFor } from '@/lib/cost-service';
import {
  totalCost,
  byCategory,
  costPerBird,
  costPerBirdPlaced,
  mortalityCostPerBird,
  costPerBirdPerDay,
  completenessNote,
  runningTotals,
  costSpan,
  CATEGORY_LABELS,
} from '@/lib/flock-costing';
import { formatGHS, pesewas } from '@/lib/money';
import { ageInDays } from '@/lib/metrics';
import { KpiTile } from '@/components/ui/KpiTile';

export const metadata: Metadata = { title: 'Flock costs' };

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * What one flock has cost.
 *
 * GUARDED ON finance:view, WHICH A WORKER DOES NOT HOLD. The specification is
 * explicit that farm staff see no financial information, and this is the screen
 * that would break that rule if the guard were only a hidden link. Anyone who
 * types the URL gets the same answer as anyone who never saw it.
 *
 * The arithmetic is all in src/lib/flock-costing.ts and none of it is here.
 * That module has no database and 35 tests; this page reads rows and lays them
 * out.
 */
export default async function FlockCostsPage({
  params,
}: {
  params: Promise<{ flockId: string }>;
}) {
  const { flockId } = await params;
  const { principal, allowed } = await pageGuard('finance:view');
  if (!allowed) return <Forbidden area="flock costs" roles={principal.roles} />;

  const flock = await db.animalGroup.findFirst({
    where: { id: flockId, site: { ...orgFilter(principal) } },
    select: {
      id: true,
      code: true,
      siteId: true,
      dateOfHatch: true,
      closedAt: true,
      productionUnit: { select: { name: true } },
      breedRef: { select: { name: true } },
    },
  });
  if (!flock) notFound();
  if (!canAccessSite(principal, flock.siteId)) notFound();

  const [entries, totals] = await Promise.all([
    costEntriesFor(principal, flock.id),
    totalsFor(flock.id),
  ]);

  const total = totalCost(entries);
  const split = byCategory(entries);
  const perAlive = costPerBird(total, totals.population);
  const perPlaced = costPerBirdPlaced(total, totals.placed);
  const mortalityCost = mortalityCostPerBird(total, totals.placed, totals.population);
  const daysReared = ageInDays(flock.dateOfHatch, flock.closedAt ?? new Date());
  const perDay = costPerBirdPerDay(total, totals.population, daysReared);
  const note = completenessNote(entries);
  const span = costSpan(entries);
  const rows = runningTotals(entries).reverse();
  const largest = split[0]?.pesewas ?? 0;

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <Link href={`/flocks/${flock.id}`} className="text-[14px] font-semibold text-brand-primary">
        ← {flock.code}
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-text-primary">Costs</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        {[flock.productionUnit?.name, flock.breedRef?.name, `day ${daysReared}`]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {entries.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border-strong bg-surface-card p-10 text-center">
          <h2 className="text-lg font-semibold text-text-primary">Nothing recorded yet</h2>
          <p className="mx-auto mt-2 max-w-lg text-[15px] text-text-secondary">
            Costs arrive here on their own: chicks from the placement, feed from the daily
            record, treatments from the health screen. Wages, electricity and transport are
            entered on the{' '}
            <Link href="/costs" className="font-semibold text-brand-primary underline">
              Costs
            </Link>{' '}
            page and divided between the flocks they covered.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile
              label="Spent so far"
              value={formatGHS(total)}
              detail={
                span ? `${day(span.first)} to ${day(span.last)}` : undefined
              }
              formula="sum of every cost entry on this flock"
            />
            <KpiTile
              label="Per bird alive"
              value={perAlive === null ? '—' : formatGHS(pesewas(perAlive))}
              detail={`${totals.population.toLocaleString('en-GH')} birds`}
              formula="total ÷ birds still alive"
            />
            <KpiTile
              label="Per bird placed"
              value={perPlaced === null ? '—' : formatGHS(pesewas(perPlaced))}
              detail={`${totals.placed.toLocaleString('en-GH')} placed`}
              formula="total ÷ birds placed"
            />
            <KpiTile
              label="Added by the losses"
              value={mortalityCost === null ? '—' : formatGHS(pesewas(mortalityCost))}
              detail="per surviving bird"
              status={mortalityCost !== null && mortalityCost > 0 ? 'attention' : 'normal'}
              formula="per bird alive − per bird placed"
            />
          </div>

          {/*
            The sentence the four tiles above cannot say on their own. A farm
            manager reads "6% mortality" as a number to feel bad about; the same
            fact in cedis per surviving bird is a number to act on.
          */}
          {mortalityCost !== null && mortalityCost > 0 ? (
            <p className="mt-4 rounded-control border-l-2 border-status-attention bg-status-attention-bg px-4 py-3 text-[14px] text-text-primary">
              The {(totals.placed - totals.population).toLocaleString('en-GH')} birds this
              flock has lost were fed and treated before they died, and that money did not
              go with them. It sits on the {totals.population.toLocaleString('en-GH')} still
              alive, at{' '}
              <strong className="font-semibold">{formatGHS(pesewas(mortalityCost))}</strong>{' '}
              each.
            </p>
          ) : null}

          <section className="mt-8 rounded-card border border-border-default bg-surface-card p-5 sm:p-6">
            <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-accent">
              Where the money went
            </h2>
            <p className="mt-2 text-[13px] text-text-secondary">
              Largest first. On a healthy rearing cycle feed is the biggest line by a
              distance; a month where it is not is a month worth looking at.
            </p>

            <ul className="mt-5 space-y-3.5">
              {split.map((c) => (
                <li key={c.category}>
                  <div className="flex items-baseline gap-3">
                    <span className="text-[15px] font-semibold text-text-primary">
                      {c.label}
                    </span>
                    <span className="ml-auto text-[15px] font-semibold tabular-nums text-text-primary">
                      {formatGHS(pesewas(c.pesewas))}
                    </span>
                    <span className="w-14 shrink-0 text-right text-[13px] tabular-nums text-text-muted">
                      {c.sharePct === null ? '—' : `${c.sharePct.toFixed(1)}%`}
                    </span>
                  </div>
                  {/*
                    Bars are drawn against the LARGEST category, not the total.
                    Against the total, everything below feed becomes a sliver
                    and the smaller lines stop being comparable with each other
                    — which is the comparison anyone is actually making here.
                  */}
                  <div
                    className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-sunken"
                    role="presentation"
                  >
                    <div
                      className="h-full rounded-full bg-brand-primary"
                      style={{
                        width: `${largest > 0 ? Math.max(2, (c.pesewas / largest) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>

            {note ? (
              <p className="mt-5 border-t border-border-default pt-3.5 text-[14px] text-status-attention">
                {note}
              </p>
            ) : (
              <p className="mt-5 border-t border-border-default pt-3.5 text-[13px] text-text-secondary">
                Every cost category has something in it, so this total is as complete as the
                records are.
              </p>
            )}
          </section>

          <section className="mt-8 rounded-card border border-border-default bg-surface-card p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-accent">
                Every entry
              </h2>
              <p className="text-[13px] text-text-secondary">
                {perDay === null
                  ? 'Not enough to give a daily rate yet.'
                  : `About ${formatGHS(pesewas(Math.round(perDay)))} per bird per day over ${daysReared} days.`}
              </p>
            </div>

            {/*
              Description on its own line rather than in a middle column. An
              allocated entry carries a sentence — "August wages — 1 of 2
              flocks, by bird-days" — and squeezing that between a date and an
              amount on a 390px phone turns every row into a paragraph three
              words wide.
            */}
            <ul className="mt-4 divide-y divide-border-default">
              {rows.map(({ entry, runningPesewas }) => (
                <li key={entry.id} className="py-3">
                  <div className="flex items-baseline gap-3">
                    <span className="min-w-0 flex-1 text-[15px] text-text-primary">
                      {entry.allocationId ? (
                        <Link
                          href={`/costs/${entry.allocationId}`}
                          className="underline-offset-2 hover:text-brand-primary hover:underline"
                        >
                          {entry.description ?? CATEGORY_LABELS[entry.category]}
                        </Link>
                      ) : (
                        (entry.description ?? CATEGORY_LABELS[entry.category])
                      )}
                    </span>
                    <span
                      className={`shrink-0 text-[15px] font-semibold tabular-nums ${
                        entry.amountPesewas < 0 ? 'text-text-muted' : 'text-text-primary'
                      }`}
                    >
                      {formatGHS(pesewas(entry.amountPesewas))}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-2 text-[12px] text-text-muted">
                    <span className="tabular-nums">{day(entry.incurredOn)}</span>
                    <span className="uppercase tracking-wide">
                      {CATEGORY_LABELS[entry.category]}
                    </span>
                    <span className="ml-auto tabular-nums">
                      {formatGHS(pesewas(runningPesewas))} so far
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
