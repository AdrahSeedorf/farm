import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { canAccessSite } from '@/lib/scope';
import { flockScheduleFor, assignableProgrammes } from '@/lib/health-service';
import { approvalNote } from '@/lib/health-programme';
import { db } from '@/lib/db';
import { ScheduleList } from '../../../health/ScheduleList';
import { AssignForm } from '../../../health/AssignForm';

export const metadata: Metadata = { title: 'Flock health' };

export default async function FlockHealthPage({
  params,
}: {
  params: Promise<{ flockId: string }>;
}) {
  const { principal, allowed } = await pageGuard('health:view');
  if (!allowed) return <Forbidden area="health records" roles={principal.roles} />;

  const { flockId } = await params;
  const view = await flockScheduleFor(principal, flockId);
  if (!view) notFound();

  const flockSite = await db.animalGroup.findUnique({
    where: { id: flockId },
    select: { siteId: true },
  });
  if (!flockSite || !canAccessSite(principal, flockSite.siteId)) notFound();

  const [canEdit, programmes] = await Promise.all([
    currentUserCan('health:edit'),
    assignableProgrammes(principal),
  ]);

  const due = view.schedule.filter((e) => e.status === 'OVERDUE' || e.status === 'DUE');

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href={`/flocks/${flockId}`} className="text-[14px] font-semibold text-brand-primary">
        ← {view.flock.code}
      </Link>

      <h1 className="mt-3 text-2xl font-bold text-text-primary">Health</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        {view.flock.houseName ? `${view.flock.houseName} · ` : ''}day {view.flock.ageDays}
        {view.flock.closed ? ' · closed' : ''}
      </p>

      {view.programme ? (
        <>
          <p
            className={`mt-5 rounded-control px-4 py-3 text-[14px] ${
              view.programme.status === 'DRAFT'
                ? 'border border-status-attention bg-status-attention-bg font-medium text-status-attention'
                : 'border border-border-default bg-surface-sunken text-text-secondary'
            }`}
          >
            <Link href={`/health/${view.programme.id}`} className="font-semibold underline">
              {view.programme.name}
            </Link>{' '}
            — {approvalNote(view.programme)}
          </p>

          {due.length > 0 ? (
            <p className="mt-3 rounded-control border border-status-critical bg-status-critical-bg px-4 py-3 text-[14px] font-medium text-status-critical">
              {due.length} thing{due.length === 1 ? '' : 's'} to do:{' '}
              {due.map((e) => e.item.name).join(', ')}.
            </p>
          ) : null}

          <section className="mt-6">
            <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-text-muted">
              Schedule
            </h2>
            <div className="mt-2.5">
              <ScheduleList schedule={view.schedule} />
            </div>
          </section>
        </>
      ) : (
        <p className="mt-6 rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-[15px] text-text-secondary">
          This flock is not following a programme, so nothing is scheduled for it. Choose one
          below — a draft works, and the reminders start straight away.
        </p>
      )}

      {canEdit ? (
        <section className="mt-8 rounded-card border border-border-default bg-surface-card p-5 sm:p-6">
          <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-accent">
            Which programme this flock follows
          </h2>
          <div className="mt-4">
            <AssignForm
              flockId={flockId}
              current={view.programme?.id ?? null}
              programmes={programmes.map((p) => ({
                id: p.id,
                name: p.name,
                status: p.status,
                itemCount: p._count.items,
              }))}
            />
          </div>
        </section>
      ) : null}
    </main>
  );
}
