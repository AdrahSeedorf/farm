import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { CustomerForm } from '../CustomerForms';

export const metadata: Metadata = { title: 'Add a buyer' };

export default async function NewCustomerPage() {
  const { principal, allowed } = await pageGuard('customer:create');
  if (!allowed) return <Forbidden area="buyers" roles={principal.roles} />;

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/customers" className="text-[14px] font-semibold text-brand-primary">
        ← Buyers
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Add a buyer</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        A name and a number is enough. Everything else can wait until you know it.
      </p>

      <div className="mt-7">
        <CustomerForm
          customerId={null}
          defaults={{
            kind: 'RETAIL',
            name: '',
            phone: '',
            businessName: '',
            email: '',
            town: '',
            notes: '',
          }}
        />
      </div>
    </main>
  );
}
