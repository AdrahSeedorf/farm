import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { recentCleaning, cleaningByUnit } from '@/lib/cleaning-service';
import { STAGE_LABELS } from '@/lib/validation/biosecurity';
import { IntervalForm } from '../IntervalForm';

export const metadata: Metadata = { title: 'Cleaning' };

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Colour only on exceptions — the design system's rule, applied here. */
const TONE: Record<string, string> = {
  OVERDUE: 'border-status-critical bg-status-critical-bg text-status-critical',
  DUE: 'border-status-attention bg-status-attention-bg text-status-attention',
  NEVER: 'border-status-attention bg-status-attention-bg text-status-attention',
  OK: 'border-border-default bg-surface-card text-text-secondary',
  UNTRACKED: 'border-border-default bg-surface-card text-text-muted',
};

export default async function CleaningPage() {
  const { principal, allowed } = await pageGuard('biosecurity:view');
  if (!allowed) return <Forbidden area="cleaning records" roles={principal.roles} />;

  const [units, recent, canCreate, canSetInterval] = await Promise.all([
    cleaningByUnit(principal),
    recentCleaning(principal),
    currentUserCan('biosecurity:create'),
    currentUserCan('site:edit'),
  ]);

  const untracked = units.filter((u) => u.status === 'UNTRACKED').length;

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <Link href="/biosecurity" className="text-[14px] font-semibold text-brand-primary">
        ← Biosecurity
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Cleaning</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            What was cleaned, with what, and when.
          </p>
        </div>
        {canCreate ? (
          <Link
            href="/biosecurity/cleaning/new"
            className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
          >
            Record a clean
          </Link>
        ) : null}
      </div>

      <section className="mt-7">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-accent">
          Where each house stands
        </h2>
        <p className="mt-2 text-[13px] text-text-secondary">
          The clock is reset by a disinfect, a fumigate or a full turnaround. A rest period
          and a dry clean are recorded, but neither is a clean house.
        </p>

        {units.length === 0 ? (
          <p className="mt-3 rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-[15px] text-text-secondary">
            No houses to track yet.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {units.map((u) => (
              <li key={u.productionUnitId} className={`rounded-card border p-4 ${TONE[u.status]}`}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[15px] font-semibold text-text-primary">{u.name}</span>
                  <span className="text-[13px] text-text-muted">{u.siteName}</span>
                  {u.lastCleanedOn ? (
                    <span className="ml-auto text-[13px] tabular-nums text-text-muted">
                      {day(u.lastCleanedOn)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[14px]">{u.sentence}</p>
                {canSetInterval ? (
                  <div className="mt-2.5">
                    <IntervalForm
                      productionUnitId={u.productionUnitId}
                      current={u.intervalDays}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {/*
          UNTRACKED is not OK, and the screen has to say so out loud or the
          distinction the pure module works so hard to keep is lost at the last
          step.
        */}
        {untracked > 0 ? (
          <p className="mt-4 text-[13px] text-text-secondary">
            {untracked} {untracked === 1 ? 'house has' : 'houses have'} no interval set. Nothing
            about {untracked === 1 ? 'it' : 'them'} is overdue, because nothing is being
            measured — which is not the same as being up to date.
          </p>
        ) : null}
      </section>

      <section className="mt-9">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-text-muted">
          Recent
        </h2>
        {recent.length === 0 ? (
          <p className="mt-2.5 rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-[15px] text-text-secondary">
            Nothing recorded yet.
          </p>
        ) : (
          <ul className="mt-2.5 divide-y divide-border-default overflow-hidden rounded-card border border-border-default bg-surface-card">
            {recent.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[15px] font-semibold text-text-primary">{r.place}</span>
                  <span className="text-[13px] text-text-secondary">
                    {STAGE_LABELS[r.stage]}
                  </span>
                  <span className="ml-auto text-[13px] tabular-nums text-text-muted">
                    {day(r.performedOn)}
                  </span>
                </div>
                <p className="mt-0.5 text-[13px] text-text-secondary">
                  {[
                    r.performedBy ? `by ${r.performedBy}` : null,
                    r.itemName && r.quantityBase !== null
                      ? `${r.quantityBase} ${r.itemUnit} ${r.itemName}`
                      : null,
                    r.dilution ? `at ${r.dilution}` : null,
                    r.contactTimeMinutes ? `${r.contactTimeMinutes} min contact` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'No further detail recorded.'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
