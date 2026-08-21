import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { orgFilter, canAccessSite } from '@/lib/scope';
import { SiteForm } from '../../SiteForm';
import { updateSite } from '../../actions';

export const metadata: Metadata = { title: 'Edit farm' };

export default async function EditSitePage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const { principal, allowed } = await pageGuard('site:edit', siteId);
  if (!canAccessSite(principal, siteId)) notFound();
  if (!allowed) return <Forbidden area="farm settings" roles={principal.roles} />;

  const site = await db.site.findFirst({ where: { id: siteId, ...orgFilter(principal) } });
  if (!site) notFound();

  const action = updateSite.bind(null, siteId);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href={`/sites/${site.id}`} className="text-[14px] font-semibold text-brand-primary">
        ← {site.name}
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Edit farm</h1>

      <div className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <SiteForm
          action={action}
          defaults={site}
          submitLabel="Save changes"
          cancelHref={`/sites/${site.id}`}
        />
      </div>
    </main>
  );
}
