import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { listUnits } from '@/lib/stock-service';
import { ItemForm } from '../ItemForm';
import { createItem } from '../actions';

export const metadata: Metadata = { title: 'Add item' };

export default async function NewItemPage() {
  const { principal, allowed } = await pageGuard('inventory:create');
  if (!allowed) return <Forbidden area="the store" roles={principal.roles} />;

  const units = await listUnits();

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/inventory" className="text-[14px] font-semibold text-brand-primary">
        ← Store
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Add an item</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        Anything the farm holds a quantity of. Nothing here is poultry-specific — the same
        list carries feed, medicine, crates and diesel.
      </p>

      <div className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <ItemForm
          action={createItem}
          units={units.map((u) => ({
            key: u.key,
            name: u.name,
            symbol: u.symbol,
            dimension: u.dimension,
          }))}
          submitLabel="Add item"
          cancelHref="/inventory"
        />
      </div>
    </main>
  );
}
