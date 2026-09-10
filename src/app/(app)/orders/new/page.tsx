import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { orderContext } from '@/lib/sales-service';
import { NewOrderForm } from '../OrderForms';

export const metadata: Metadata = { title: 'Take an order' };

export default async function NewOrderPage() {
  const { principal, allowed } = await pageGuard('order:create');
  if (!allowed) return <Forbidden area="orders" roles={principal.roles} />;

  const { customers, sites } = await orderContext(principal);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/orders" className="text-[14px] font-semibold text-brand-primary">
        ← Orders
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Take an order</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        Who it is for, then what they want. Nothing is committed until you confirm it.
      </p>

      {customers.length === 0 ? (
        <section className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
          <p className="text-[15px] font-medium text-text-primary">
            There is nobody to sell to yet.
          </p>
          <p className="mt-2 text-[14px] text-text-secondary">
            Add a buyer first —{' '}
            <Link href="/customers/new" className="font-semibold text-brand-primary hover:underline">
              add one here
            </Link>
            .
          </p>
        </section>
      ) : (
        <div className="mt-7">
          <NewOrderForm customers={customers} sites={sites} />
        </div>
      )}
    </main>
  );
}
