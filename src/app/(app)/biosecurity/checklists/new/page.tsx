import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { NewChecklistForm } from '../../ChecklistForms';

export const metadata: Metadata = { title: 'New checklist' };

export default async function NewChecklistPage() {
  const { principal, allowed } = await pageGuard('biosecurity:manage');
  if (!allowed) return <Forbidden area="checklists" roles={principal.roles} />;

  return (
    <main className="mx-auto max-w-xl px-5 py-8">
      <Link
        href="/biosecurity/checklists"
        className="text-[14px] font-semibold text-brand-primary"
      >
        ← Checklists
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-text-primary">New checklist</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        Name it, then add the lines. A set of common starting points is offered once it
        exists.
      </p>
      <div className="mt-8">
        <NewChecklistForm />
      </div>
    </main>
  );
}
