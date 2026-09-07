import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { listIncidents } from '@/lib/incident-service';
import {
  stateOf,
  isUnattended,
  incidentSentence,
  incidentSummary,
  KIND_LABELS,
} from '@/lib/incidents';
import { ReviewForm, CloseForm } from './IncidentForms';

export const metadata: Metadata = { title: 'Incidents' };

const when = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

/**
 * What went wrong.
 *
 * REPORTS NOBODY HAS READ COME FIRST, never the most severe. A serious incident
 * that has been dealt with needs less attention than a minor one nobody has
 * looked at — and an unread report teaches the person who wrote it that
 * reporting achieves nothing, which is what stops the next one being written.
 */
export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ closed?: string }>;
}) {
  const { principal, allowed } = await pageGuard('incident:view');
  if (!allowed) return <Forbidden area="incidents" roles={principal.roles} />;

  const { closed } = await searchParams;
  const includeClosed = closed === '1';
  const now = new Date();

  const [incidents, canReport, canReview, canClose] = await Promise.all([
    listIncidents(principal, { includeClosed, asOf: now }),
    currentUserCan('incident:create'),
    currentUserCan('incident:edit'),
    currentUserCan('incident:approve'),
  ]);

  const summary = incidentSummary(incidents, now);
  const stale = incidents.some((i) => isUnattended(i, now));

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Incidents</h1>
          <p
            className={`mt-1 text-[15px] ${
              stale ? 'font-medium text-status-attention' : 'text-text-secondary'
            }`}
          >
            {summary}
          </p>
        </div>
        {canReport ? (
          <Link
            href="/incidents/new"
            className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
          >
            Report something
          </Link>
        ) : null}
      </div>

      {incidents.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border-strong bg-surface-card p-10 text-center">
          <h2 className="text-lg font-semibold text-text-primary">Nothing reported</h2>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-text-secondary">
            A fox, a power cut, a broken drinker, somebody hurt. Worth writing down even
            when it turned out to be nothing — one of them is a one-off and three of them
            are a pattern.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {incidents.map((incident) => {
            const state = stateOf(incident);
            const unattended = isUnattended(incident, now);
            return (
              <li key={incident.id}>
                <div
                  className={`rounded-card border bg-surface-card p-5 ${
                    unattended
                      ? 'border-status-attention'
                      : state === 'CLOSED'
                        ? 'border-dashed border-border-strong'
                        : 'border-border-default'
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="font-mono text-[13px] font-semibold text-text-muted">
                      {incident.reference}
                    </span>
                    <span className="text-[13px] text-text-muted">
                      {incident.kind ? KIND_LABELS[incident.kind] : 'Uncategorised'} ·{' '}
                      {incident.siteName}
                    </span>
                  </div>

                  <p className="mt-2 whitespace-pre-line text-[15px] text-text-primary">
                    {incident.what}
                  </p>

                  <p className="mt-2 text-[13px] text-text-muted">
                    Happened {when(incident.occurredAt)} · reported by{' '}
                    {incident.reportedByName}
                  </p>

                  <p
                    className={`mt-2 text-[14px] ${
                      unattended
                        ? 'font-medium text-status-attention'
                        : 'text-text-secondary'
                    }`}
                  >
                    {incidentSentence(incident, now)}
                  </p>
                  {incident.reviewNote ? (
                    <p className="mt-0.5 text-[13px] text-text-secondary">
                      {incident.reviewNote}
                    </p>
                  ) : null}

                  {canReview || canClose ? (
                    <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-border-default pt-3">
                      {canReview && state !== 'CLOSED' ? (
                        <ReviewForm
                          incidentId={incident.id}
                          reviewed={state === 'REVIEWED'}
                        />
                      ) : null}
                      {/* Rendered for a closed report too — see the note in
                          CloseForm. It hides its own button. */}
                      {canClose && state !== 'REPORTED' ? (
                        <CloseForm
                          incidentId={incident.id}
                          closed={state === 'CLOSED'}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-8 text-[14px]">
        <Link
          href={includeClosed ? '/incidents' : '/incidents?closed=1'}
          className="font-semibold text-brand-primary"
        >
          {includeClosed ? 'Hide closed reports' : 'Show closed reports'}
        </Link>
      </p>
    </main>
  );
}
