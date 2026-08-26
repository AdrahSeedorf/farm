import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { itemById, itemBatches, itemMovements, itemOnHand } from '@/lib/stock-service';
import {
  expiredBatches,
  expiringSoon,
  weightedUnitCost,
  stockStatus,
} from '@/lib/stock-ledger';
import { BASE_UNIT, formatQuantity } from '@/lib/uom';
import { formatGHS, pesewas } from '@/lib/money';
import { CATEGORY_META, type ItemCategory } from '@/lib/validation/item';
import { StatusPill } from '../StatusPill';

export const metadata: Metadata = { title: 'Item' };

const MOVEMENT_LABELS: Record<string, string> = {
  PURCHASE_RECEIPT: 'Received',
  ISSUE: 'Issued',
  RETURN: 'Returned',
  TRANSFER_IN: 'Transferred in',
  TRANSFER_OUT: 'Transferred out',
  ADJUSTMENT: 'Adjusted',
  DAMAGE: 'Damaged',
  EXPIRY: 'Written off (expired)',
  SALE: 'Sold',
  PRODUCTION: 'Produced',
  CONSUMPTION: 'Consumed',
};

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function ItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { principal, allowed } = await pageGuard('inventory:view');
  if (!allowed) return <Forbidden area="the store" roles={principal.roles} />;

  const { itemId } = await params;
  const item = await itemById(principal, itemId);
  if (!item) notFound();

  const [batches, movements, totalOnHand, canEdit, canReceive] = await Promise.all([
    itemBatches(principal, itemId),
    itemMovements(principal, itemId),
    itemOnHand(principal, itemId),
    currentUserCan('inventory:edit'),
    currentUserCan('inventory:create'),
  ]);

  const base = BASE_UNIT[item.stockUom.dimension as 'COUNT' | 'MASS' | 'VOLUME'];
  const show = (quantity: number) => formatQuantity(quantity, base, item.stockUom.key);

  const cost = weightedUnitCost(batches);
  // What sits in named batches, which is what the cost figure can speak for.
  const inBatches = batches.reduce((sum, b) => sum + b.onHand, 0);

  const now = new Date();
  const expired = expiredBatches(batches, now);
  const soon = expiringSoon(batches, now, 60);

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <Link href="/inventory" className="text-[14px] font-semibold text-brand-primary">
        ← Store
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{item.name}</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            {CATEGORY_META[item.category as ItemCategory]?.label ?? item.category}
            {' · '}
            <span className="font-mono text-[13px]">{item.sku}</span>
            {' · counted in '}
            {item.stockUom.name.toLowerCase()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canReceive ? (
            <Link
              href="/inventory/receive"
              className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
            >
              Record a delivery
            </Link>
          ) : null}
          {canEdit ? (
            <Link
              href={`/inventory/${item.id}/edit`}
              className="inline-flex min-h-touch items-center rounded-control border border-border-strong px-4 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
            >
              Edit
            </Link>
          ) : null}
        </div>
      </div>

      <dl className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-card border border-border-default bg-surface-card p-4">
          <dt className="text-[12px] font-bold uppercase tracking-[0.14em] text-text-muted">
            On hand
          </dt>
          <dd className="tabular mt-1 text-xl font-bold text-text-primary">{show(totalOnHand)}</dd>
          <dd className="mt-1.5">
            <StatusPill
              status={stockStatus(totalOnHand, item.reorderLevel, item.minimumStock)}
            />
          </dd>
        </div>
        <div className="rounded-card border border-border-default bg-surface-card p-4">
          <dt className="text-[12px] font-bold uppercase tracking-[0.14em] text-text-muted">
            Cost of what is here
          </dt>
          <dd className="tabular mt-1 text-xl font-bold text-text-primary">
            {cost === null ? '—' : `${formatGHS(pesewas(cost))} / ${base}`}
          </dd>
          <dd className="mt-1.5 text-[13px] text-text-secondary">
            {cost === null
              ? 'No price recorded on the stock held.'
              : 'Weighted across the batches on hand.'}
          </dd>
        </div>
        <div className="rounded-card border border-border-default bg-surface-card p-4">
          <dt className="text-[12px] font-bold uppercase tracking-[0.14em] text-text-muted">
            Value on hand
          </dt>
          <dd className="tabular mt-1 text-xl font-bold text-text-primary">
            {cost === null ? '—' : formatGHS(pesewas(Math.round(inBatches * cost)))}
          </dd>
          <dd className="mt-1.5 text-[13px] text-text-secondary">
            {Math.abs(inBatches - totalOnHand) > 0.001
              ? `Covers the ${show(inBatches)} held in named batches.`
              : 'At the cost above.'}
          </dd>
        </div>
      </dl>

      {expired.length > 0 ? (
        <p className="mt-6 rounded-control border border-status-critical bg-status-critical-bg px-4 py-3 text-[14px] font-medium text-status-critical">
          {expired.length} batch{expired.length === 1 ? '' : 'es'} past the expiry date with stock
          still recorded: {expired.map((b) => b.batchNumber).join(', ')}. Write it off so the figure
          matches the store.
        </p>
      ) : null}
      {soon.length > 0 ? (
        <p className="mt-3 rounded-control border border-status-attention bg-status-attention-bg px-4 py-3 text-[14px] font-medium text-status-attention">
          Expiring within 60 days:{' '}
          {soon.map((b) => `${b.batchNumber} (${day(b.expiresOn!)})`).join(', ')}. These are issued
          first.
        </p>
      ) : null}

      <section className="mt-8">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-text-muted">
          Batches
        </h2>
        {batches.length === 0 ? (
          <p className="mt-2.5 rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-[15px] text-text-secondary">
            Nothing received yet.
          </p>
        ) : (
          <div className="mt-2.5 overflow-x-auto rounded-card border border-border-default bg-surface-card">
            <table className="w-full min-w-[34rem] text-left text-[14px]">
              <thead>
                <tr className="border-b border-border-default text-[12px] uppercase tracking-[0.1em] text-text-muted">
                  <th className="px-4 py-2.5 font-semibold">Batch</th>
                  <th className="px-4 py-2.5 font-semibold">Expires</th>
                  <th className="px-4 py-2.5 text-right font-semibold">On hand</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {batches.map((b) => (
                  <tr key={b.id} className={b.onHand > 0 ? '' : 'text-text-muted'}>
                    <td className="px-4 py-2.5 font-mono text-[13px]">{b.batchNumber}</td>
                    <td className="px-4 py-2.5">{b.expiresOn ? day(b.expiresOn) : '—'}</td>
                    <td className="tabular px-4 py-2.5 text-right">{show(b.onHand)}</td>
                    <td className="tabular px-4 py-2.5 text-right">
                      {b.unitCostPesewas === null || b.unitCostPesewas === undefined
                        ? '—'
                        : `${formatGHS(pesewas(b.unitCostPesewas))} / ${base}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-text-muted">
          Movements
        </h2>
        {movements.length === 0 ? (
          <p className="mt-2.5 rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-[15px] text-text-secondary">
            No movements recorded.
          </p>
        ) : (
          <ul className="mt-2.5 divide-y divide-border-default overflow-hidden rounded-card border border-border-default bg-surface-card">
            {movements.map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
                <span className="tabular text-[13px] text-text-muted">{day(m.occurredOn)}</span>
                <span className="text-[14px] font-semibold text-text-primary">
                  {MOVEMENT_LABELS[m.type] ?? m.type}
                </span>
                <span className="tabular text-[14px] text-text-primary">
                  {/* What the person actually typed, kept legible: "4 bags", not "200 kg". */}
                  {m.enteredQuantity} {m.enteredUom.symbol}
                </span>
                <span className="text-[13px] text-text-secondary">
                  {m.stockLocation.name}
                  {m.itemBatch ? ` · batch ${m.itemBatch.batchNumber}` : ''}
                  {m.notes ? ` · ${m.notes}` : ''}
                </span>
                <span className="ml-auto text-[13px] text-text-muted">{m.recordedBy.name}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
