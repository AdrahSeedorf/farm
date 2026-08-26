import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { listItemsWithStock } from '@/lib/stock-service';
import { hasFullSiteAccess } from '@/lib/scope';
import { BASE_UNIT, formatQuantity } from '@/lib/uom';
import { CATEGORY_META, type ItemCategory } from '@/lib/validation/item';
import { StatusPill } from './StatusPill';
import { ArchiveToggle } from './ArchiveToggle';

export const metadata: Metadata = { title: 'Store' };

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; created?: string }>;
}) {
  const { principal, allowed } = await pageGuard('inventory:view');
  if (!allowed) return <Forbidden area="the store" roles={principal.roles} />;

  const { show, created } = await searchParams;
  const includeInactive = show === 'all';

  const items = await listItemsWithStock(principal, { includeInactive });
  const [canCreate, canEdit, canManage] = await Promise.all([
    currentUserCan('inventory:create'),
    currentUserCan('inventory:edit'),
    currentUserCan('inventory:manage'),
  ]);

  // Grouped by category because that is how a store is walked: feed in one
  // corner, vaccines in the fridge, crates by the door.
  const byCategory = new Map<string, typeof items>();
  for (const item of items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }

  // Confirmation after a create. Resolved from the list already fetched rather
  // than from the URL, so the page never echoes back whatever was typed into it.
  const justCreated = created ? items.find((i) => i.id === created) : undefined;

  const needsAttention = items.filter(
    (i) => i.status === 'OUT' || i.status === 'CRITICAL' || i.status === 'LOW',
  );

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Store</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            {hasFullSiteAccess(principal)
              ? 'Quantities across every farm.'
              : `Quantities at the ${principal.siteScope.length} farm(s) you cover.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canManage ? (
            <Link
              href="/inventory/locations"
              className="inline-flex min-h-touch items-center rounded-control border border-border-strong px-4 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
            >
              Stores
            </Link>
          ) : null}
          {canCreate ? (
            <Link
              href="/inventory/new"
              className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
            >
              Add item
            </Link>
          ) : null}
        </div>
      </div>

      {justCreated ? (
        <p
          role="status"
          className="mt-6 rounded-control border border-border-strong bg-surface-sunken px-4 py-3 text-[14px] font-medium text-text-primary"
        >
          {justCreated.name} added, saved as {justCreated.sku}.
        </p>
      ) : null}

      {needsAttention.length > 0 ? (
        <p className="mt-6 rounded-control border border-status-attention bg-status-attention-bg px-4 py-3 text-[14px] font-medium text-status-attention">
          {needsAttention.length} item{needsAttention.length === 1 ? '' : 's'} at or below
          the level you set: {needsAttention.map((i) => i.name).join(', ')}.
        </p>
      ) : null}

      {items.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border-strong bg-surface-card p-10 text-center">
          <h2 className="text-lg font-semibold text-text-primary">Nothing in the store yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-text-secondary">
            An item is anything the farm holds a quantity of — feed, vaccines, disinfectant,
            crates, diesel. Add them first, then record what arrives and what goes out.
          </p>
          {canCreate ? (
            <Link
              href="/inventory/new"
              className="mt-6 inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
            >
              Add your first item
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="mt-7 space-y-8">
          {[...byCategory.entries()].map(([category, list]) => (
            <section key={category}>
              <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-text-muted">
                {CATEGORY_META[category as ItemCategory]?.label ?? category}
              </h2>
              <ul className="mt-2.5 divide-y divide-border-default overflow-hidden rounded-card border border-border-default bg-surface-card">
                {list.map((item) => (
                  <li
                    key={item.id}
                    className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 ${
                      item.isActive ? '' : 'opacity-60'
                    }`}
                  >
                    <div className="min-w-[10rem] flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-[15px] font-semibold text-text-primary">
                          {item.name}
                        </span>
                        <span className="font-mono text-[12px] text-text-muted">{item.sku}</span>
                        {item.isActive ? null : (
                          <span className="text-[12px] font-semibold text-text-muted">
                            archived
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[13px] text-text-secondary">
                        Counted in {item.unitName.toLowerCase()}
                        {item.isPerishable ? ' · expires' : ''}
                        {item.reorderLevelBase !== null
                          ? ` · reorder at ${formatQuantity(item.reorderLevelBase, BASE_UNIT[item.dimension], item.unitKey)}`
                          : ''}
                      </p>
                    </div>

                    <div className="text-right">
                      <div className="tabular text-[15px] font-semibold text-text-primary">
                        {formatQuantity(
                          item.onHandBase,
                          BASE_UNIT[item.dimension],
                          item.unitKey,
                        )}
                      </div>
                      <div className="mt-1">
                        <StatusPill status={item.status} />
                      </div>
                    </div>

                    {canEdit ? (
                      <div className="flex items-center gap-1">
                        <Link
                          href={`/inventory/${item.id}/edit`}
                          className="min-h-[36px] rounded-control px-2.5 py-1.5 text-[13px] font-semibold text-brand-primary hover:bg-brand-primary-soft"
                        >
                          Edit
                        </Link>
                        <ArchiveToggle
                          itemId={item.id}
                          isActive={item.isActive}
                          name={item.name}
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {items.length > 0 || includeInactive ? (
        <p className="mt-8 text-[14px]">
          <Link
            href={includeInactive ? '/inventory' : '/inventory?show=all'}
            className="font-semibold text-brand-primary"
          >
            {includeInactive ? 'Hide archived items' : 'Show archived items'}
          </Link>
        </p>
      ) : null}
    </main>
  );
}
