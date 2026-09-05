import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { checklistById } from '@/lib/checklist-service';
import { AddLineForm, LineToggle, StarterButton } from '../../ChecklistForms';

export const metadata: Metadata = { title: 'Checklist' };

export default async function ChecklistPage({
  params,
}: {
  params: Promise<{ checklistId: string }>;
}) {
  const { principal, allowed } = await pageGuard('biosecurity:view');
  if (!allowed) return <Forbidden area="checklists" roles={principal.roles} />;

  const { checklistId } = await params;
  const checklist = await checklistById(principal, checklistId);
  if (!checklist) notFound();

  const canManage = await currentUserCan('biosecurity:manage');
  const live = checklist.items.filter((i) => i.isActive);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link
        href="/biosecurity/checklists"
        className="text-[14px] font-semibold text-brand-primary"
      >
        ← Checklists
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-text-primary">{checklist.name}</h1>
      {checklist.description ? (
        <p className="mt-1 text-[15px] text-text-secondary">{checklist.description}</p>
      ) : null}

      {checklist.items.length === 0 && canManage ? (
        <section className="mt-8 rounded-card border-l-2 border-brand-accent bg-surface-sunken p-5">
          <h2 className="text-[15px] font-semibold text-text-primary">Nothing on it yet</h2>
          <p className="mt-1.5 text-[14px] text-text-secondary">
            These are common starting points for a poultry farm — prompts to go and look at
            something, not a standard and not an audit scheme. Add them and change whatever
            does not fit here, or write your own from scratch below.
          </p>
          <div className="mt-4">
            <StarterButton checklistId={checklist.id} />
          </div>
        </section>
      ) : null}

      {/*
        Said whether the list is empty or full. The empty-state panel that
        offers the starter lines disappears the moment they are added, taking
        this sentence with it — and "every line is yours to reword or remove" is
        exactly what somebody needs to read AFTER they have a list, not before.
      */}
      {checklist.items.length > 0 ? (
        <p className="mt-6 text-[13px] text-text-secondary">
          Every line here is yours. Reword anything that does not match how this farm works,
          remove what does not apply, and add whatever your vet or your buyer asks for.
        </p>
      ) : null}

      {checklist.items.length > 0 ? (
        <ul className="mt-4 divide-y divide-border-default overflow-hidden rounded-card border border-border-default bg-surface-card">
          {checklist.items.map((item) => (
            <li
              key={item.id}
              className={`flex flex-wrap items-start gap-3 px-4 py-3.5 ${
                item.isActive ? '' : 'opacity-60'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-text-primary">
                  {item.label}
                  {!item.isActive ? (
                    <span className="ml-2 text-[12px] font-normal uppercase tracking-wide text-text-muted">
                      retired
                    </span>
                  ) : null}
                </span>
                {item.guidance ? (
                  <span className="mt-0.5 block text-[13px] text-text-secondary">
                    {item.guidance}
                  </span>
                ) : null}
                {item._count.lines > 0 ? (
                  <span className="mt-0.5 block text-[12px] text-text-muted">
                    Answered in {item._count.lines} inspection
                    {item._count.lines === 1 ? '' : 's'}
                  </span>
                ) : null}
              </span>
              {canManage ? (
                <LineToggle
                  itemId={item.id}
                  checklistId={checklist.id}
                  isActive={item.isActive}
                  label={item.label}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        Retired, never deleted. Past inspections point at these lines, and
        deleting one would either destroy an answer or leave one nobody can name.
      */}
      {canManage ? (
        <>
          <p className="mt-3 text-[13px] text-text-muted">
            Retiring a line takes it off future inspections. It is never deleted — past
            inspections point at it, and their answers have to stay readable.
          </p>
          <section className="mt-8 rounded-card border border-border-default bg-surface-card p-5">
            <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-accent">
              Add a line
            </h2>
            <div className="mt-4">
              <AddLineForm checklistId={checklist.id} />
            </div>
          </section>
        </>
      ) : null}

      <p className="mt-6 text-[13px] text-text-secondary">
        {live.length} line{live.length === 1 ? '' : 's'} on the next inspection.
      </p>
    </main>
  );
}
