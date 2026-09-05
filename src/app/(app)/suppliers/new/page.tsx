import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { farmLeadTime } from '@/lib/supplier-service';
import { SupplierForm } from '../SupplierForm';
import { addSupplier } from '../actions';

export const metadata: Metadata = { title: 'Add supplier' };

export default async function NewSupplierPage() {
  const { principal, allowed } = await pageGuard('supplier:create');
  if (!allowed) return <Forbidden area="suppliers" roles={principal.roles} />;

  const lead = await farmLeadTime(principal);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/suppliers" className="text-[14px] font-semibold text-brand-primary">
        ← Suppliers
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Add a supplier</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        Only the name is required. The rest can be filled in as you learn it.
      </p>

      <div className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <SupplierForm
          action={addSupplier}
          farmLeadTimeDays={lead}
          submitLabel="Add supplier"
          cancelHref="/suppliers"
        />
      </div>
    </main>
  );
}
