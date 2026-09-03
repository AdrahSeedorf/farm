import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { orgFilter, siteIdFilter } from '@/lib/scope';
import { suggestFlockCode } from '@/lib/flock-service';
import { PlacementForm } from '../PlacementForm';
import { placeFlock } from '../actions';

export const metadata: Metadata = { title: 'Place a flock' };

export default async function NewFlockPage() {
  const { principal, allowed } = await pageGuard('flock:create');
  if (!allowed) return <Forbidden area="flocks" roles={principal.roles} />;

  // V1 runs one farm. When there are several, this becomes a picker.
  const site = await db.site.findFirst({
    where: { ...orgFilter(principal), ...siteIdFilter(principal), isActive: true },
    orderBy: { createdAt: 'asc' },
    include: {
      productionUnits: { where: { isActive: true }, orderBy: { code: 'asc' } },
    },
  });

  if (!site) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-8">
        <h1 className="text-2xl font-bold text-text-primary">Place a flock</h1>
        <p className="mt-3 rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-[15px] text-text-secondary">
          You need a farm before you can place a flock.{' '}
          <Link href="/sites/new" className="font-semibold text-brand-primary">
            Add a farm
          </Link>
          .
        </p>
      </main>
    );
  }

  if (site.productionUnits.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-8">
        <h1 className="text-2xl font-bold text-text-primary">Place a flock</h1>
        <p className="mt-3 rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-[15px] text-text-secondary">
          {site.name} has no houses yet. Birds are placed into a house.{' '}
          <Link href={`/sites/${site.id}`} className="font-semibold text-brand-primary">
            Add a house
          </Link>
          .
        </p>
      </main>
    );
  }

  const today = new Date();
  const [suggestedCode, breeds] = await Promise.all([
    suggestFlockCode(site.id, today.getUTCFullYear()),
    db.breed.findMany({
      where: { ...orgFilter(principal), isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, standards: true },
    }),
  ]);
  const action = placeFlock.bind(null, site.id);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/flocks" className="text-[14px] font-semibold text-brand-primary">
        ← Flocks
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Place a flock</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        This records the birds you received and opens the flock&apos;s permanent history at{' '}
        {site.name}.
      </p>

      <div className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <PlacementForm
          action={action}
          houses={site.productionUnits}
          breeds={breeds.map((b) => ({
            id: b.id,
            name: b.name,
            hasStandard: Boolean(
              b.standards &&
                typeof b.standards === 'object' &&
                'bodyWeightByAgeDays' in (b.standards as Record<string, unknown>),
            ),
          }))}
          suggestedCode={suggestedCode}
          today={today.toISOString().slice(0, 10)}
        />
      </div>
    </main>
  );
}
