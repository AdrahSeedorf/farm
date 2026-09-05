import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { visitorsOnSite, recentVisits, visitorSites } from '@/lib/visitor-service';
import { VISITOR_KIND_LABELS, type VisitorKind } from '@/lib/validation/biosecurity';
import { describeHours, hoursBetween } from '@/lib/biosecurity';
import { cleaningByUnit } from '@/lib/cleaning-service';
import { openFailures, recentChecks } from '@/lib/checklist-service';
import { DowntimeForm } from './DowntimeForm';
import { SignOutButton } from './SignOutButton';

export const metadata: Metadata = { title: 'Biosecurity' };

const clock = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

export default async function BiosecurityPage() {
  const { principal, allowed } = await pageGuard('biosecurity:view');
  if (!allowed) return <Forbidden area="biosecurity records" roles={principal.roles} />;

  const [onSite, recent, sites, cleaning, failures, lastChecks, canCreate, canEdit, canSetRule] =
    await Promise.all([
    visitorsOnSite(principal),
    recentVisits(principal, 30),
    visitorSites(principal),
    cleaningByUnit(principal),
    openFailures(principal),
    recentChecks(principal, 1),
    currentUserCan('biosecurity:create'),
    currentUserCan('biosecurity:edit'),
      currentUserCan('site:edit'),
    ]);

  const now = new Date();
  const noRule = sites.some((s) => s.visitorDowntimeHours === null);
  const needsCleaning = cleaning.filter(
    (c) => c.status === 'OVERDUE' || c.status === 'DUE' || c.status === 'NEVER',
  );

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Biosecurity</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            Who came onto the farm, and what they said on the way in.
          </p>
        </div>
        {canCreate ? (
          <Link
            href="/biosecurity/visitors/new"
            className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
          >
            Log a visitor
          </Link>
        ) : null}
      </div>

      {/*
        Who is here NOW is the one thing that has to be right at the moment
        somebody asks. Oldest first: a visitor who arrived four hours ago and
        never signed out is the interesting row, not the one who just walked in.
      */}
      <section className="mt-7">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-accent">
          On the farm now
        </h2>
        {onSite.length === 0 ? (
          <p className="mt-2.5 rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-[15px] text-text-secondary">
            Nobody is signed in. Everyone logged today has signed out again.
          </p>
        ) : (
          <ul className="mt-2.5 divide-y divide-border-default overflow-hidden rounded-card border border-border-default bg-surface-card">
            {onSite.map((v) => (
              <li key={v.id} className="px-4 py-3.5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    href={`/biosecurity/visitors/${v.id}`}
                    className="text-[15px] font-semibold text-text-primary underline-offset-2 hover:text-brand-primary hover:underline"
                  >
                    {v.name}
                  </Link>
                  <span className="text-[13px] text-text-secondary">
                    {VISITOR_KIND_LABELS[v.kind as VisitorKind]}
                  </span>
                  {v.enteredProductionUnit ? (
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      in a house
                    </span>
                  ) : null}
                  <span className="ml-auto text-[13px] tabular-nums text-text-muted">
                    {describeHours(hoursBetween(v.arrivedAt, now))} ago
                  </span>
                </div>
                <p
                  className={`mt-1 text-[13px] ${
                    v.downtime.status === 'WITHIN_DOWNTIME'
                      ? 'font-medium text-status-attention'
                      : 'text-text-secondary'
                  }`}
                >
                  {v.downtimeNote}
                </p>
                {canEdit ? (
                  <div className="mt-2">
                    <SignOutButton visitId={v.id} nowLocal={now.toISOString().slice(0, 16)} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        SHOWN WHETHER OR NOT A RULE IS SET, not only when one is missing. A
        section that vanishes the moment it is filled in takes its own success
        message with it, and leaves no way to see or change the figure later.
      */}
      {canSetRule ? (
        <section
          className={`mt-8 rounded-card p-5 ${
            noRule
              ? 'border-l-2 border-brand-accent bg-surface-sunken'
              : 'border border-border-default bg-surface-card'
          }`}
        >
          <h2 className="text-[15px] font-semibold text-text-primary">
            {noRule ? 'No downtime rule is set' : 'Downtime rule'}
          </h2>
          <p className="mt-1.5 text-[14px] text-text-secondary">
            {noRule
              ? 'Visits are recorded either way, and the log will say how long a visitor has been clear of other poultry — but with no rule to measure it against, nothing is flagged.'
              : 'How long a visitor should be clear of other poultry before coming here.'}{' '}
            How many hours to ask for is a judgement about disease pressure where you are;
            your veterinarian or the District Veterinary Officer is the person to settle it
            with.
          </p>
          <div className="mt-4 space-y-4">
            {sites.map((s) => (
              <DowntimeForm
                key={s.id}
                siteId={s.id}
                siteName={s.name}
                current={s.visitorDowntimeHours}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/*
        THE HONEST EMPTY STATE. Three logs all showing "nothing yet" in three
        separate places reads as a working screen with no news on it. Said once,
        at the top, it reads as what it is: a farm that has not started
        recording any of this.
      */}
      {onSite.length === 0 &&
      recent.length === 0 &&
      lastChecks.length === 0 &&
      cleaning.every((c) => c.lastCleanedOn === null) ? (
        <div className="mt-7 rounded-card border border-dashed border-border-strong bg-surface-card p-8">
          <h2 className="text-lg font-semibold text-text-primary">Nothing recorded yet</h2>
          <p className="mt-2 max-w-lg text-[15px] text-text-secondary">
            Three things go in here: who comes onto the farm, what gets cleaned, and what an
            inspection finds. None of them is worth much on its own — together they are what
            a vet, a buyer or an inspector will ask to see, and they can only be built
            forwards from today.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {canCreate ? (
              <>
                <Link
                  href="/biosecurity/visitors/new"
                  className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-4 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
                >
                  Log a visitor
                </Link>
                <Link
                  href="/biosecurity/cleaning/new"
                  className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-4 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
                >
                  Record a clean
                </Link>
                <Link
                  href="/biosecurity/checklists"
                  className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-4 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
                >
                  Build a checklist
                </Link>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {/*
        The last inspection's failures come first: they are the things somebody
        has already gone and found, and nobody has answered since.
      */}
      {failures.length > 0 ? (
        <section className="mt-8 rounded-card border border-status-critical bg-status-critical-bg p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-status-critical">
              Failed at the last inspection
            </h2>
            <Link
              href="/biosecurity/checks"
              className="text-[13px] font-semibold text-status-critical underline underline-offset-2"
            >
              All inspections →
            </Link>
          </div>
          <ul className="mt-3 space-y-1.5">
            {failures.flatMap((f) =>
              f.failures.map((line) => (
                <li key={`${f.checkId}-${line.key}`} className="text-[15px] text-status-critical">
                  <strong className="font-semibold">{line.label}</strong>
                  {line.note ? ` — ${line.note}` : ''}
                </li>
              )),
            )}
          </ul>
        </section>
      ) : null}

      {/*
        Cleaning that is due sits above the visit history, because it is a thing
        somebody has to go and DO — and the history is a thing to look up.
      */}
      <section className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-accent">
            Cleaning
          </h2>
          <span className="flex gap-4">
            <Link
              href="/biosecurity/checks"
              className="text-[13px] font-semibold text-brand-primary"
            >
              Inspections →
            </Link>
            <Link
              href="/biosecurity/cleaning"
              className="text-[13px] font-semibold text-brand-primary"
            >
              Cleaning records →
            </Link>
          </span>
        </div>
        {needsCleaning.length === 0 ? (
          <p className="mt-2.5 text-[14px] text-text-secondary">
            Nothing is due. Houses with no interval set are not counted here, because
            nothing about them is being measured.
          </p>
        ) : (
          <ul className="mt-2.5 space-y-2">
            {needsCleaning.map((c) => (
              <li
                key={c.productionUnitId}
                className={`rounded-control border px-4 py-2.5 text-[14px] ${
                  c.status === 'OVERDUE'
                    ? 'border-status-critical bg-status-critical-bg text-status-critical'
                    : 'border-status-attention bg-status-attention-bg text-status-attention'
                }`}
              >
                <strong className="font-semibold">{c.name}</strong> — {c.sentence}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        Shown even with nothing wrong, because "when did anybody last walk the
        farm" is a question with a right answer either way — and a section that
        only appears on failure teaches people it is not there.
      */}
      <section className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-accent">
            Inspections
          </h2>
          <Link
            href="/biosecurity/checks"
            className="text-[13px] font-semibold text-brand-primary"
          >
            All inspections →
          </Link>
        </div>
        {lastChecks.length === 0 ? (
          <p className="mt-2.5 text-[14px] text-text-secondary">
            Nobody has walked a checklist yet.
          </p>
        ) : (
          <p className="mt-2.5 text-[14px] text-text-secondary">
            Last walked {lastChecks[0].performedOn.toISOString().slice(0, 10)} —{' '}
            {lastChecks[0].checklistName}, {lastChecks[0].sentence.toLowerCase()}
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-text-muted">
          Recent visits
        </h2>
        {recent.length === 0 ? (
          <p className="mt-2.5 rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-[15px] text-text-secondary">
            Nothing logged yet. The gate book starts with the first delivery.
          </p>
        ) : (
          <ul className="mt-2.5 divide-y divide-border-default overflow-hidden rounded-card border border-border-default bg-surface-card">
            {recent.map((v) => (
              <li key={v.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    href={`/biosecurity/visitors/${v.id}`}
                    className="text-[15px] text-text-primary underline-offset-2 hover:text-brand-primary hover:underline"
                  >
                    {v.name}
                  </Link>
                  {v.organisation ? (
                    <span className="text-[13px] text-text-secondary">{v.organisation}</span>
                  ) : null}
                  <span className="ml-auto text-[12px] tabular-nums text-text-muted">
                    {clock(v.arrivedAt)}
                    {v.departedAt ? ` → ${clock(v.departedAt).slice(11)}` : ' → still here'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
