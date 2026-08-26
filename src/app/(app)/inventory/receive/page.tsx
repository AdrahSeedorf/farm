import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { receiptContext } from '@/lib/receipt-service';
import { ReceiveForm } from './ReceiveForm';

export const metadata: Metadata = { title: 'Record a delivery' };

export default async function ReceivePage() {
  const { principal, allowed } = await pageGuard('inventory:create');
  if (!allowed) return <Forbidden area="the store" roles={principal.roles} />;

  const { items, units, locations } = await receiptContext(principal);

  // Today in UTC, matching how every date in this system is stored. Computed on
  // the server so the form's ceiling cannot be moved by a phone with the wrong
  // clock — the client attribute is a convenience, the rule is in the schema.
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/inventory" className="text-[14px] font-semibold text-brand-primary">
        ← Store
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Record a delivery</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        What arrived, into which store, and what it cost. The form stays open so a delivery
        note with several lines can be entered one line after another.
      </p>

      <div className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <ReceiveForm items={items} units={units} locations={locations} today={today} />
      </div>
    </main>
  );
}
