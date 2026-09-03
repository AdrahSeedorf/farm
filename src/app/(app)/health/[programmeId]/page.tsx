import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { orgFilter } from '@/lib/scope';
import { programmeById } from '@/lib/health-service';
import { approvalNote, ROUTE_LABELS, type Route } from '@/lib/health-programme';
import { StatusBadge } from '../StatusBadge';
import { ImportPanel } from '../ImportPanel';
import { ApprovalPanel } from '../ApprovalPanel';
import { ItemForm } from '../ItemForm';
import { RemoveItemButton } from '../RemoveItemButton';

export const metadata: Metadata = { title: 'Health programme' };

const TYPE_LABELS: Record<string, string> = {
  VACCINATION: 'Vaccination',
  MEDICATION: 'Medication',
  SUPPLEMENT: 'Supplement',
  TREATMENT: 'Treatment',
  VET_VISIT: 'Vet visit',
  DIAGNOSIS: 'Diagnosis',
  POST_MORTEM: 'Post-mortem',
  OTHER: 'Other',
};

export default async function ProgrammePage({
  params,
}: {
  params: Promise<{ programmeId: string }>;
}) {
  const { principal, allowed } = await pageGuard('health:view');
  if (!allowed) return <Forbidden area="health records" roles={principal.roles} />;

  const { programmeId } = await params;
  const programme = await programmeById(principal, programmeId);
  if (!programme) notFound();

  const [canEdit, canApprove, stockItems] = await Promise.all([
    currentUserCan('health:edit'),
    currentUserCan('health:approve'),
    db.item.findMany({
      where: {
        ...orgFilter(principal),
        isActive: true,
        // Only what a health entry could plausibly draw on. A programme entry
        // linked to layer mash would be a mistake nobody catches.
        category: { in: ['VACCINE', 'MEDICINE', 'DISINFECTANT', 'OTHER'] },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, sku: true },
    }),
  ]);

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);

  const draft = programme.status === 'DRAFT';

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <Link href="/health" className="text-[14px] font-semibold text-brand-primary">
        ← Health
      </Link>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h1 className="text-2xl font-bold text-text-primary">{programme.name}</h1>
        <StatusBadge status={programme.status} />
      </div>
      {programme.description ? (
        <p className="mt-1 text-[15px] text-text-secondary">{programme.description}</p>
      ) : null}

      <p
        className={`mt-5 rounded-control px-4 py-3 text-[14px] ${
          draft
            ? 'border border-status-attention bg-status-attention-bg font-medium text-status-attention'
            : 'border border-border-default bg-surface-sunken text-text-secondary'
        }`}
      >
        {approvalNote(programme)}
      </p>

      {/* --- entries ------------------------------------------------------ */}
      <section className="mt-8">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-text-muted">
          The schedule
        </h2>

        {programme.items.length === 0 ? (
          <p className="mt-2.5 rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-[15px] text-text-secondary">
            Nothing scheduled yet. Paste your vet or hatchery&apos;s table below, or add
            entries one at a time.
          </p>
        ) : (
          <div className="mt-2.5 overflow-x-auto rounded-card border border-border-default bg-surface-card">
            <table className="w-full min-w-[40rem] text-left text-[14px]">
              <thead>
                <tr className="border-b border-border-default text-[11px] uppercase tracking-[0.1em] text-text-muted">
                  <th className="px-4 py-2.5 font-semibold">Day</th>
                  <th className="px-4 py-2.5 font-semibold">What</th>
                  <th className="px-4 py-2.5 font-semibold">Route</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Dose</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Withdrawal</th>
                  {canEdit ? <th className="px-4 py-2.5" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {programme.items.map((item) => (
                  <tr key={item.id}>
                    <td className="tabular px-4 py-2.5 font-semibold text-text-primary">
                      {item.ageDays}
                      <span className="ml-1 text-[12px] font-normal text-text-muted">
                        ±{item.windowDays}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-text-primary">{item.name}</span>
                      <span className="ml-2 text-[12px] text-text-muted">
                        {TYPE_LABELS[item.eventType]}
                      </span>
                      {item.item ? (
                        <span className="ml-2 text-[12px] text-text-secondary">
                          · {item.item.name}
                        </span>
                      ) : null}
                      {item.notes ? (
                        <span className="block text-[12px] text-text-muted">{item.notes}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary">
                      {item.route ? ROUTE_LABELS[item.route as Route] : '—'}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right">{item.dosePerBird ?? '—'}</td>
                    <td className="tabular px-4 py-2.5 text-right text-text-secondary">
                      {item.eggWithdrawalDays === null && item.meatWithdrawalDays === null
                        ? '—'
                        : `${item.eggWithdrawalDays ?? '—'} / ${item.meatWithdrawalDays ?? '—'}`}
                    </td>
                    {canEdit ? (
                      <td className="px-4 py-2.5 text-right">
                        <RemoveItemButton
                          programmeId={programme.id}
                          itemId={item.id}
                          name={item.name}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {programme.items.length > 0 ? (
          <p className="mt-2 text-[12px] text-text-muted">
            Withdrawal shown as eggs / meat, in days. A dash means none was recorded — which
            is not the same as none applying.
          </p>
        ) : null}
      </section>

      {/* --- import ------------------------------------------------------- */}
      {canEdit ? (
        <section className="mt-8 rounded-card border border-border-default bg-surface-card p-5 sm:p-6">
          <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-accent">
            Import a table
          </h2>
          <div className="mt-4">
            <ImportPanel programmeId={programme.id} />
          </div>
        </section>
      ) : null}

      {/* --- add one ------------------------------------------------------ */}
      {canEdit ? (
        <section className="mt-6 rounded-card border border-border-default bg-surface-card p-5 sm:p-6">
          <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-accent">
            Add a single entry
          </h2>
          <div className="mt-4">
            <ItemForm programmeId={programme.id} items={stockItems} />
          </div>
        </section>
      ) : null}

      {/* --- approval ----------------------------------------------------- */}
      {canApprove ? (
        <section className="mt-6 rounded-card border border-border-default bg-surface-card p-5 sm:p-6">
          <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-accent">
            Veterinary review
          </h2>
          <p className="mt-3 text-[14px] text-text-secondary">
            Record who checked this schedule for this farm. Changing any entry afterwards
            clears the approval, so a vet&apos;s name can never end up on a schedule they
            never saw.
          </p>
          <div className="mt-4">
            <ApprovalPanel
              programmeId={programme.id}
              status={programme.status}
              approvedByName={programme.approvedByName}
              today={today}
            />
          </div>
        </section>
      ) : null}

      {programme.animalGroups.length > 0 ? (
        <p className="mt-6 text-[14px] text-text-secondary">
          Followed by:{' '}
          {programme.animalGroups.map((f, i) => (
            <span key={f.id}>
              {i > 0 ? ', ' : ''}
              <Link href={`/flocks/${f.id}`} className="font-semibold text-brand-primary">
                {f.code}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
    </main>
  );
}
