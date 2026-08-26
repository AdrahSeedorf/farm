import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { itemById, listUnits, movementCountForItem } from '@/lib/stock-service';
import { fromBase } from '@/lib/uom';
import { ItemForm } from '../../ItemForm';
import { updateItem } from '../../actions';

export const metadata: Metadata = { title: 'Edit item' };

export default async function EditItemPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { principal, allowed } = await pageGuard('inventory:edit');
  if (!allowed) return <Forbidden area="the store" roles={principal.roles} />;

  const { itemId } = await params;
  const item = await itemById(principal, itemId);
  if (!item) notFound();

  const [units, movements] = await Promise.all([listUnits(), movementCountForItem(itemId)]);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/inventory" className="text-[14px] font-semibold text-brand-primary">
        ← Store
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">{item.name}</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        {movements === 0
          ? 'No movements recorded yet, so anything here can still change.'
          : `${movements} movement${movements === 1 ? '' : 's'} recorded against this item.`}
      </p>

      <div className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <ItemForm
          action={updateItem.bind(null, item.id)}
          units={units.map((u) => ({
            key: u.key,
            name: u.name,
            symbol: u.symbol,
            dimension: u.dimension,
          }))}
          // Thresholds are stored in the base unit and shown in the item's own
          // unit, which is the only figure the storekeeper ever typed.
          defaults={{
            name: item.name,
            category: item.category,
            sku: item.sku,
            stockUomKey: item.stockUom.key,
            reorderLevel:
              item.reorderLevel === null ? null : fromBase(item.reorderLevel, item.stockUom.key),
            minimumStock:
              item.minimumStock === null ? null : fromBase(item.minimumStock, item.stockUom.key),
            isPerishable: item.isPerishable,
          }}
          lockedDimension={movements > 0 ? item.stockUom.dimension : undefined}
          submitLabel="Save changes"
          cancelHref="/inventory"
        />
      </div>
    </main>
  );
}
