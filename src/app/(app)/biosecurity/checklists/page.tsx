import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { listChecklists } from '@/lib/checklist-service';

export const metadata: Metadata = { title: 'Checklists' };

export default async function ChecklistsPage() {
  const { principal, allowed } = await pageGuard('biosecurity:view');
  if (!allowed) return <Forbidden area="checklists" roles={principal.roles} />;

  const [checklists, canManage] = await Promise.all([
    listChecklists(principal),
    currentUserCan('biosecurity:manage'),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/biosecurity/checks" className="text-[14px] font-semibold text-brand-primary">
        ← Inspections
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Checklists</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            What an inspection walks through.
          </p>
        </div>
        {canManage ? (
          <Link
            href="/biosecurity/checklists/new"
            className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
          >
            New checklist
          </Link>
        ) : null}
      </div>

      <p className="mt-6 rounded-control border-l-2 border-brand-accent bg-surface-sunken px-4 py-3 text-[14px] text-text-secondary">
        <strong className="font-semibold text-text-primary">
          This system ships no checklist as a standard.
        </strong>{' '}
        What matters on a particular farm depends on its layout, its neighbours and whoever
        buys from it. A set of common starting points is offered when a list is empty — they
        are prompts to go and look at something, and every one of them is yours to reword or
        remove. Your veterinarian and your buyer will both have views worth adding.
      </p>

      {checklists.length === 0 ? (
        <p className="mt-6 rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-[15px] text-text-secondary">
          No checklists yet.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-border-default overflow-hidden rounded-card border border-border-default bg-surface-card">
          {checklists.map((c) => (
            <li key={c.id} className={`px-4 py-4 ${c.isActive ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Link
                  href={`/biosecurity/checklists/${c.id}`}
                  className="text-[16px] font-semibold text-text-primary underline-offset-2 hover:text-brand-primary hover:underline"
                >
                  {c.name}
                </Link>
                <span className="ml-auto text-[13px] text-text-secondary">
                  {c.items.length} line{c.items.length === 1 ? '' : 's'}
                  {c._count.checks > 0
                    ? ` · walked ${c._count.checks} time${c._count.checks === 1 ? '' : 's'}`
                    : ''}
                </span>
              </div>
              {c.description ? (
                <p className="mt-1 text-[13px] text-text-secondary">{c.description}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
