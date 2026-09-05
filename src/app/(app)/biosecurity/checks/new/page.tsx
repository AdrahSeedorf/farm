import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { listChecklists } from '@/lib/checklist-service';
import { visitorSites } from '@/lib/visitor-service';
import { CheckForm } from '../../CheckForm';

export const metadata: Metadata = { title: 'Walk a checklist' };

export default async function NewCheckPage() {
  const { principal, allowed } = await pageGuard('biosecurity:create');
  if (!allowed) return <Forbidden area="inspections" roles={principal.roles} />;

  const [checklists, sites] = await Promise.all([
    listChecklists(principal),
    visitorSites(principal),
  ]);

  const usable = checklists
    .filter((c) => c.isActive && c.items.length > 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      items: c.items.map((i) => ({ id: i.id, label: i.label, guidance: i.guidance })),
    }));

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/biosecurity/checks" className="text-[14px] font-semibold text-brand-primary">
        ← Inspections
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-text-primary">Walk a checklist</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        Every line starts as not checked. Leaving one blank is a finding, not a pass.
      </p>

      {usable.length === 0 ? (
        <p className="mt-8 rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-[15px] text-text-secondary">
          There is no checklist with any lines on it yet.
        </p>
      ) : (
        <div className="mt-8">
          <CheckForm
            checklists={usable}
            sites={sites.map((s) => ({ id: s.id, name: s.name }))}
            today={new Date().toISOString().slice(0, 10)}
          />
        </div>
      )}
    </main>
  );
}
