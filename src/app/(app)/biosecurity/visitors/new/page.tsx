import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { visitorSites } from '@/lib/visitor-service';
import { VisitorForm } from '../../VisitorForm';

export const metadata: Metadata = { title: 'Log a visitor' };

export default async function NewVisitorPage() {
  const { principal, allowed } = await pageGuard('biosecurity:create');
  if (!allowed) return <Forbidden area="the visitor log" roles={principal.roles} />;

  const sites = await visitorSites(principal);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/biosecurity" className="text-[14px] font-semibold text-brand-primary">
        ← Biosecurity
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-text-primary">Log a visitor</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        Everything here is a record of what was said and done, not of what was verified.
      </p>

      {sites.length === 0 ? (
        <p className="mt-8 rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-[15px] text-text-secondary">
          There is no farm to log a visit at yet.
        </p>
      ) : (
        <div className="mt-8">
          <VisitorForm sites={sites} nowLocal={new Date().toISOString().slice(0, 16)} />
        </div>
      )}
    </main>
  );
}
