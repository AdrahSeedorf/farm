import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { visitorsOnSite, recentVisits, visitorSites } from '@/lib/visitor-service';
import { VISITOR_KIND_LABELS, type VisitorKind } from '@/lib/validation/biosecurity';
import { describeHours, hoursBetween } from '@/lib/biosecurity';
import { DowntimeForm } from './DowntimeForm';
import { SignOutButton } from './SignOutButton';

export const metadata: Metadata = { title: 'Biosecurity' };

const clock = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

export default async function BiosecurityPage() {
  const { principal, allowed } = await pageGuard('biosecurity:view');
  if (!allowed) return <Forbidden area="biosecurity records" roles={principal.roles} />;

  const [onSite, recent, sites, canCreate, canEdit, canSetRule] = await Promise.all([
    visitorsOnSite(principal),
    recentVisits(principal, 30),
    visitorSites(principal),
    currentUserCan('biosecurity:create'),
    currentUserCan('biosecurity:edit'),
    currentUserCan('site:edit'),
  ]);

  const now = new Date();
  const noRule = sites.some((s) => s.visitorDowntimeHours === null);

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
