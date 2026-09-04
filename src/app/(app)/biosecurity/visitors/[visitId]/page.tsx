import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { visitById } from '@/lib/visitor-service';
import { VISITOR_KIND_LABELS, type VisitorKind } from '@/lib/validation/biosecurity';
import { describeHours, hoursBetween } from '@/lib/biosecurity';
import { SignOutButton } from '../../SignOutButton';

export const metadata: Metadata = { title: 'Visit' };

const clock = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

/** A three-state answer, rendered so a blank never reads as a no. */
function Recorded({ label, value }: { label: string; value: boolean | null }) {
  return (
    <div>
      <dt className="text-[13px] text-text-muted">{label}</dt>
      <dd className={value === null ? 'text-text-muted' : 'text-text-primary'}>
        {value === null ? 'Not recorded' : value ? 'Yes' : 'No'}
      </dd>
    </div>
  );
}

export default async function VisitPage({
  params,
}: {
  params: Promise<{ visitId: string }>;
}) {
  const { principal, allowed } = await pageGuard('biosecurity:view');
  if (!allowed) return <Forbidden area="biosecurity records" roles={principal.roles} />;

  const { visitId } = await params;
  const visit = await visitById(principal, visitId);
  if (!visit) notFound();

  const canEdit = await currentUserCan('biosecurity:edit');
  const inside = visit.downtime.status === 'WITHIN_DOWNTIME';

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/biosecurity" className="text-[14px] font-semibold text-brand-primary">
        ← Biosecurity
      </Link>

      <h1 className="mt-2 text-2xl font-bold text-text-primary">{visit.name}</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        {[
          VISITOR_KIND_LABELS[visit.kind as VisitorKind],
          visit.organisation,
          visit.siteName,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      <p
        className={`mt-6 rounded-control px-4 py-3 text-[15px] ${
          inside
            ? 'border border-status-attention bg-status-attention-bg font-medium text-status-attention'
            : 'border border-border-default bg-surface-card text-text-primary'
        }`}
      >
        {visit.downtimeNote}
      </p>
      {/*
        The rule as it stood THAT DAY, not today's. See downtimeHoursAtEntry —
        tightening the farm's rule must not retrospectively make a compliant
        visit look non-compliant.
      */}
      <p className="mt-2 text-[13px] text-text-muted">
        {visit.downtimeHoursAtEntry === null
          ? 'This farm had no downtime rule when they arrived.'
          : `Measured against the ${visit.downtimeHoursAtEntry}-hour rule in force when they arrived.`}
      </p>

      <dl className="mt-8 grid gap-4 rounded-card border border-border-default bg-surface-card p-5 text-[15px] sm:grid-cols-2">
        <div>
          <dt className="text-[13px] text-text-muted">Arrived</dt>
          <dd className="text-text-primary">{clock(visit.arrivedAt)}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-text-muted">Left</dt>
          <dd className={visit.departedAt ? 'text-text-primary' : 'text-status-attention'}>
            {visit.departedAt
              ? `${clock(visit.departedAt)} · ${describeHours(hoursBetween(visit.arrivedAt, visit.departedAt))} on site`
              : 'Still signed in'}
          </dd>
        </div>
        {visit.phone ? (
          <div>
            <dt className="text-[13px] text-text-muted">Phone</dt>
            <dd className="text-text-primary">{visit.phone}</dd>
          </div>
        ) : null}
        {visit.vehicleRegistration ? (
          <div>
            <dt className="text-[13px] text-text-muted">Vehicle</dt>
            <dd className="font-mono text-text-primary">{visit.vehicleRegistration}</dd>
          </div>
        ) : null}
        {visit.purpose ? (
          <div className="sm:col-span-2">
            <dt className="text-[13px] text-text-muted">Purpose</dt>
            <dd className="text-text-primary">{visit.purpose}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-[13px] text-text-muted">Went into a house with birds</dt>
          <dd className="text-text-primary">{visit.enteredProductionUnit ? 'Yes' : 'No'}</dd>
        </div>
        <Recorded label="Used the footbath" value={visit.usedFootbath} />
        <Recorded label="Wore farm clothing" value={visit.woreFarmClothing} />
        {visit.notes ? (
          <div className="sm:col-span-2">
            <dt className="text-[13px] text-text-muted">Notes</dt>
            <dd className="text-text-primary">{visit.notes}</dd>
          </div>
        ) : null}
      </dl>

      <p className="mt-4 text-[13px] text-text-muted">Logged by {visit.recordedByName}.</p>

      {canEdit && !visit.departedAt ? (
        <div className="mt-6">
          <SignOutButton visitId={visit.id} nowLocal={new Date().toISOString().slice(0, 16)} />
        </div>
      ) : null}
    </main>
  );
}
