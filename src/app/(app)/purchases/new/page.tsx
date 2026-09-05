import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { orderContext } from '@/lib/order-service';
import { OrderHeaderForm } from '../OrderHeaderForm';
import { placeOrder } from '../actions';

export const metadata: Metadata = { title: 'Place an order' };

export default async function NewOrderPage() {
  const { principal, allowed } = await pageGuard('procurement:create');
  if (!allowed) return <Forbidden area="ordering" roles={principal.roles} />;

  const context = await orderContext(principal);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/purchases" className="text-[14px] font-semibold text-brand-primary">
        ← Purchases
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Place an order</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        Start with who and when. You add what you are buying on the next screen, one line
        at a time, so nothing is lost if the connection drops.
      </p>

      {context.suppliers.length === 0 ? (
        <div className="mt-7 rounded-card border border-dashed border-border-strong bg-surface-card p-8 text-center">
          <h2 className="text-lg font-semibold text-text-primary">No suppliers yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-text-secondary">
            An order is placed with somebody. Add the supplier first — their lead time is
            what fills in the delivery date here.
          </p>
          <Link
            href="/suppliers/new"
            className="mt-6 inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
          >
            Add a supplier
          </Link>
        </div>
      ) : (
        <div className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
          <OrderHeaderForm
            action={placeOrder}
            sites={context.sites}
            suppliers={context.suppliers}
            today={today}
            defaults={{ orderedOn: today }}
            submitLabel="Start the order"
            cancelHref="/purchases"
          />
        </div>
      )}
    </main>
  );
}
