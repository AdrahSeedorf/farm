import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { orgFilter, canAccessSite } from '@/lib/scope';
import { ProductionUnitForm } from '../ProductionUnitForm';
import { createProductionUnit, archiveProductionUnit } from '../actions';

export const metadata: Metadata = { title: 'Farm' };

export default async function SitePage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const { principal, allowed } = await pageGuard('site:view', siteId);

  // A site outside the principal's scope is NOT FOUND, not FORBIDDEN.
  // "You may not see this farm" still confirms the farm exists.
  if (!canAccessSite(principal, siteId)) notFound();
  if (!allowed) return <Forbidden area="farm settings" roles={principal.roles} />;

  const site = await db.site.findFirst({
    where: { id: siteId, ...orgFilter(principal) },
    include: {
      productionUnits: { orderBy: [{ isActive: 'desc' }, { code: 'asc' }] },
    },
  });
  if (!site) notFound();

  const canEdit = await currentUserCan('site:edit', siteId);
  const canCreate = await currentUserCan('site:create', siteId);

  const active = site.productionUnits.filter((u) => u.isActive);
  const totalCapacity = active.reduce((sum, u) => sum + (u.capacity ?? 0), 0);

  const createUnit = createProductionUnit.bind(null, siteId);

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <Link href="/sites" className="text-[14px] font-semibold text-brand-primary">
        ← Farms
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-text-primary">{site.name}</h1>
            <span className="rounded bg-brand-primary-soft px-2 py-0.5 font-mono text-[12px] font-semibold text-brand-primary">
              {site.code}
            </span>
          </div>
          <p className="mt-1 text-[15px] text-text-secondary">
            {[site.town, site.district, site.region].filter(Boolean).join(', ') ||
              'Location not set'}
          </p>
        </div>
        {canEdit ? (
          <Link
            href={`/sites/${site.id}/edit`}
            className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-4 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
          >
            Edit farm
          </Link>
        ) : null}
      </div>

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold text-text-primary">Houses</h2>
          <p className="text-[13px] text-text-muted">
            {active.length} active
            {totalCapacity > 0 ? ` · ${totalCapacity.toLocaleString('en-GH')} bird capacity` : ''}
          </p>
        </div>

        {site.productionUnits.length === 0 ? (
          <p className="mt-3 rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-center text-[15px] text-text-secondary">
            No houses yet. Add the first one below — flocks are placed into houses.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border-default overflow-hidden rounded-card border border-border-default bg-surface-card">
            {site.productionUnits.map((unit) => (
              <li key={unit.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="font-semibold text-text-primary">{unit.name}</span>
                    <span className="font-mono text-[12px] text-text-muted">{unit.code}</span>
                    {!unit.isActive ? (
                      <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        Archived
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[13px] text-text-secondary">
                    {unit.capacity
                      ? `${unit.capacity.toLocaleString('en-GH')} bird capacity`
                      : 'Capacity not set'}
                  </p>
                </div>
                {canEdit ? (
                  <form action={archiveProductionUnit.bind(null, unit.id, siteId)}>
                    <button
                      type="submit"
                      className="min-h-[40px] rounded-control border border-border-strong px-3 text-[13px] font-semibold text-text-secondary hover:bg-surface-sunken"
                    >
                      {unit.isActive ? 'Archive' : 'Restore'}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canCreate ? (
          <div className="mt-5 rounded-card border border-border-default bg-surface-card p-5">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
              Add a house
            </h3>
            <div className="mt-4">
              <ProductionUnitForm action={createUnit} />
            </div>
          </div>
        ) : null}
      </section>

      <p className="mt-8 border-t border-border-default pt-4 text-[13px] text-text-muted">
        Houses are archived, never deleted — a house that held a flock is part of that
        flock&apos;s history.
      </p>
    </main>
  );
}
