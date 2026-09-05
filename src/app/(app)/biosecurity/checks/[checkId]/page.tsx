import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { checkById } from '@/lib/checklist-service';
import { RESULT_LABELS, type CheckResultValue } from '@/lib/validation/biosecurity';

export const metadata: Metadata = { title: 'Inspection' };

const day = (d: Date) => d.toISOString().slice(0, 10);

const TONE: Record<CheckResultValue, string> = {
  PASS: 'text-text-secondary',
  FAIL: 'font-semibold text-status-critical',
  NOT_CHECKED: 'font-medium text-status-attention',
  NOT_APPLICABLE: 'text-text-muted',
};

export default async function CheckPage({
  params,
}: {
  params: Promise<{ checkId: string }>;
}) {
  const { principal, allowed } = await pageGuard('biosecurity:view');
  if (!allowed) return <Forbidden area="inspections" roles={principal.roles} />;

  const { checkId } = await params;
  const check = await checkById(principal, checkId);
  if (!check) notFound();

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/biosecurity/checks" className="text-[14px] font-semibold text-brand-primary">
        ← Inspections
      </Link>

      <h1 className="mt-2 text-2xl font-bold text-text-primary">{check.checklistName}</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        {[check.siteName, day(check.performedOn), check.performedBy]
          .filter(Boolean)
          .join(' · ')}
      </p>

      <p
        className={`mt-6 rounded-control px-4 py-3 text-[15px] ${
          check.summary.failed > 0
            ? 'border border-status-critical bg-status-critical-bg font-medium text-status-critical'
            : 'border border-border-default bg-surface-card text-text-primary'
        }`}
      >
        {check.sentence}
        {/*
          A score against what was JUDGED, not the whole list — and no score at
          all when nothing was. See summariseChecks.
        */}
        {check.summary.scorePct !== null
          ? ` ${check.summary.scorePct.toFixed(0)}% of what was judged.`
          : ''}
      </p>

      <ul className="mt-6 divide-y divide-border-default overflow-hidden rounded-card border border-border-default bg-surface-card">
        {check.lines.map((line) => (
          <li key={line.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
            <span className="min-w-0 flex-1 text-[15px] text-text-primary">
              {line.label}
              {line.note ? (
                <span className="mt-0.5 block text-[13px] text-status-critical">{line.note}</span>
              ) : null}
            </span>
            <span className={`shrink-0 text-[13px] ${TONE[line.result as CheckResultValue]}`}>
              {RESULT_LABELS[line.result as CheckResultValue]}
            </span>
          </li>
        ))}
      </ul>

      {/*
        The wording is the wording that was on the page that morning. See
        BiosecurityCheckLine.labelAtCheck.
      */}
      <p className="mt-3 text-[13px] text-text-muted">
        Each line is shown as it was worded when this inspection was walked, even if the
        checklist has been reworded since.
      </p>

      {check.notes ? (
        <p className="mt-6 rounded-card border border-border-default bg-surface-card p-4 text-[15px] text-text-primary">
          {check.notes}
        </p>
      ) : null}

      <p className="mt-4 text-[13px] text-text-muted">Recorded by {check.recordedByName}.</p>
    </main>
  );
}
