import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { supplierById, farmLeadTime } from '@/lib/supplier-service';
import { SupplierForm } from '../../SupplierForm';
import { editSupplier } from '../../actions';

export const metadata: Metadata = { title: 'Edit supplier' };

export default async function EditSupplierPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const { supplierId } = await params;
  const { principal, allowed } = await pageGuard('supplier:edit');
  if (!allowed) return <Forbidden area="suppliers" roles={principal.roles} />;

  const [supplier, lead] = await Promise.all([
    supplierById(principal, supplierId),
    farmLeadTime(principal),
  ]);
  if (!supplier) notFound();

  const action = editSupplier.bind(null, supplier.id);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link
        href={`/suppliers/${supplier.id}`}
        className="text-[14px] font-semibold text-brand-primary"
      >
        ← {supplier.name}
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Edit supplier</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        The code <span className="font-mono font-semibold">{supplier.code}</span> stays as it
        is — past paperwork quotes it.
      </p>

      <div className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <SupplierForm
          action={action}
          defaults={supplier}
          farmLeadTimeDays={lead}
          submitLabel="Save changes"
          cancelHref={`/suppliers/${supplier.id}`}
        />
      </div>
    </main>
  );
}
