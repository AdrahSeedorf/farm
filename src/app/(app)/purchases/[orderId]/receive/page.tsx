import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { receiveContext } from '@/lib/order-receipt-service';
import { ORDER_STATE_LABELS } from '@/lib/purchasing';
import { ReceiveAgainstOrderForm } from '../../ReceiveAgainstOrderForm';

export const metadata: Metadata = { title: 'Record a delivery' };

/**
 * Receiving against an order.
 *
 * Gated on `inventory:create`, not `procurement:*`. The person signing for a
 * lorry is the storekeeper, and a farm where only whoever placed the order may
 * book the goods in is a farm with stock sitting unrecorded in a yard.
 */
export default async function ReceivePage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const { principal, allowed } = await pageGuard('inventory:create');
  if (!allowed) return <Forbidden area="receiving stock" roles={principal.roles} />;

  const today = new Date();
  const context = await receiveContext(
    principal,
    orderId,
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())),
  );
  if (!context) notFound();

  const iso = today.toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link
        href={`/purchases/${context.orderId}`}
        className="text-[14px] font-semibold text-brand-primary"
      >
        ← {context.orderNumber}
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Record a delivery</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        From {context.supplierName}, into {context.siteName}. Record what actually arrived —
        the order keeps saying what was agreed either way.
      </p>

      {/* A draft or cancelled order can still be received against, and the
          service warns rather than refuses. Said here too, so it is not a
          surprise after the form has been filled in. */}
      {context.state !== 'SENT' ? (
        <p className="mt-5 rounded-control border border-status-attention bg-status-attention-bg px-4 py-3 text-[14px] font-medium text-status-attention">
          This order is {ORDER_STATE_LABELS[context.state].toLowerCase()}.{' '}
          {context.state === 'DRAFT'
            ? 'If it was placed by phone and written up afterwards, that is fine — record the delivery and mark the order sent so the record matches what happened.'
            : 'If the goods turned up anyway, record them. The cancellation stays on the record and somebody should find out why they came.'}
        </p>
      ) : null}

      <div className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <ReceiveAgainstOrderForm
          orderId={context.orderId}
          orderNumber={context.orderNumber}
          lines={context.lines}
          locations={context.locations}
          today={iso}
        />
      </div>

      <p className="mt-6 text-[14px] text-text-secondary">
        A delivery nobody ordered through this system goes in{' '}
        <Link href="/inventory/receive" className="font-semibold text-brand-primary">
          the store instead
        </Link>
        . Not every bag has an order behind it, and forcing one would mean either fake
        orders or unrecorded stock.
      </p>
    </main>
  );
}
