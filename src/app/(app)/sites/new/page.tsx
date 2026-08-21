import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { SiteForm } from '../SiteForm';
import { createSite } from '../actions';

export const metadata: Metadata = { title: 'Add farm' };

export default async function NewSitePage() {
  const { principal, allowed } = await pageGuard('site:create');
  if (!allowed) return <Forbidden area="farm settings" roles={principal.roles} />;

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/sites" className="text-[14px] font-semibold text-brand-primary">
        ← Farms
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Add a farm</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        A physical location. Houses, flocks, stock and staff all belong to one.
      </p>

      <div className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <SiteForm action={createSite} submitLabel="Create farm" cancelHref="/sites" />
      </div>
    </main>
  );
}
