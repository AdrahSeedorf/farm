import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { customerById } from '@/lib/customer-service';
import { displayName } from '@/lib/customers';
import { CustomerForm } from '../../CustomerForms';

export const metadata: Metadata = { title: 'Edit buyer' };

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { principal, allowed } = await pageGuard('customer:edit');
  if (!allowed) return <Forbidden area="buyers" roles={principal.roles} />;

  const { customerId } = await params;
  const customer = await customerById(principal, customerId);
  if (!customer) notFound();

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link
        href={`/customers/${customer.id}`}
        className="text-[14px] font-semibold text-brand-primary"
      >
        ← {displayName(customer)}
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Edit buyer</h1>

      <div className="mt-7">
        <CustomerForm
          customerId={customer.id}
          defaults={{
            kind: customer.kind,
            name: customer.name,
            phone: customer.phone,
            businessName: customer.businessName ?? '',
            email: customer.email ?? '',
            town: customer.town ?? '',
            notes: customer.notes ?? '',
          }}
        />
      </div>
    </main>
  );
}
