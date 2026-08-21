import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { orgFilter, siteIdFilter, hasFullSiteAccess } from '@/lib/scope';

export const metadata: Metadata = { title: 'Farms' };

export default async function SitesPage() {
  const { principal, allowed } = await pageGuard('site:view');
  if (!allowed) return <Forbidden area="farm settings" roles={principal.roles} />;

  // Scope is applied IN the query, not after it.
  const sites = await db.site.findMany({
    where: { ...orgFilter(principal), ...siteIdFilter(principal) },
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { productionUnits: true, animalGroups: true } },
    },
  });

  const canCreate = await currentUserCan('site:create');

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Farms</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            {hasFullSiteAccess(principal)
              ? 'You have access to every farm.'
              : `You have access to ${principal.siteScope.length} farm(s).`}
          </p>
        </div>
        {canCreate ? (
          <Link
            href="/sites/new"
            className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
          >
            Add farm
          </Link>
        ) : null}
      </div>

      {sites.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border-strong bg-surface-card p-10 text-center">
          <h2 className="text-lg font-semibold text-text-primary">No farms yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-text-secondary">
            A farm is a physical location. Houses, flocks and stock all belong to one, so
            this is the first thing to set up.
          </p>
          {canCreate ? (
            <Link
              href="/sites/new"
              className="mt-6 inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
            >
              Add your first farm
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {sites.map((site) => (
            <li key={site.id}>
              <Link
                href={`/sites/${site.id}`}
                className="block rounded-card border border-border-default bg-surface-card p-5 transition-colors hover:border-brand-primary"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-lg font-bold text-text-primary">{site.name}</h2>
                  <span className="rounded bg-brand-primary-soft px-2 py-0.5 font-mono text-[12px] font-semibold text-brand-primary">
                    {site.code}
                  </span>
                </div>
                <p className="mt-1 text-[14px] text-text-secondary">
                  {[site.town, site.district, site.region].filter(Boolean).join(', ') ||
                    'Location not set'}
                </p>
                <dl className="mt-4 flex gap-6 border-t border-border-default pt-3 text-[13px]">
                  <div>
                    <dt className="text-text-muted">Houses</dt>
                    <dd className="tabular font-semibold text-text-primary">
                      {site._count.productionUnits}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">Flocks</dt>
                    <dd className="tabular font-semibold text-text-primary">
                      {site._count.animalGroups}
                    </dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
