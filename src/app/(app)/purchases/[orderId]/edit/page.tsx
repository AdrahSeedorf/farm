import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { orderById, orderContext } from '@/lib/order-service';
import { OrderHeaderForm } from '../../OrderHeaderForm';
import { editOrder } from '../../actions';

export const metadata: Metadata = { title: 'Edit order' };

export default async function EditOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const { principal, allowed } = await pageGuard('procurement:edit');
  if (!allowed) return <Forbidden area="ordering" roles={principal.roles} />;

  const [order, context] = await Promise.all([
    orderById(principal, orderId),
    orderContext(principal),
  ]);
  if (!order) notFound();
  if (order.state === 'CANCELLED') notFound();

  const action = editOrder.bind(null, order.id);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link
        href={`/purchases/${order.id}`}
        className="text-[14px] font-semibold text-brand-primary"
      >
        ← {order.orderNumber}
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Edit order details</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        The dates and the notes. What was ordered is changed on the order itself.
      </p>

      <div className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <OrderHeaderForm
          action={action}
          sites={context.sites}
          suppliers={context.suppliers}
          locked={order.state === 'SENT'}
          today={new Date().toISOString().slice(0, 10)}
          defaults={{
            siteId: order.siteId,
            supplierId: order.supplierId,
            orderedOn: iso(order.orderedOn),
            expectedOn: order.expectedOn ? iso(order.expectedOn) : '',
            notes: order.notes,
          }}
          submitLabel="Save changes"
          cancelHref={`/purchases/${order.id}`}
        />
      </div>
    </main>
  );
}
