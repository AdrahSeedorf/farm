import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { allocationCandidates } from '@/lib/cost-service';
import { AllocationForm } from './AllocationForm';

export const metadata: Metadata = { title: 'Record a cost' };

/**
 * The dates live in the URL, not in the form.
 *
 * Bird-days and bird counts come off the population ledger, which only the
 * server can read. Change the period and the weights change, so changing the
 * period has to reach the server — putting the three dates in the query string
 * is the plainest way to do that, and it makes the page shareable and
 * refreshable into the bargain.
 */
export default async function NewCostPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; on?: string }>;
}) {
  const { principal, allowed } = await pageGuard('finance:create');
  if (!allowed) return <Forbidden area="farm costs" roles={principal.roles} />;

  const params = await searchParams;
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const on = parseDate(params.on) ?? startOfDay(today);
  const from = parseDate(params.from) ?? firstOfMonth(on);
  const to = parseDate(params.to) ?? on;

  const candidates = await allocationCandidates(principal, {
    periodStart: from,
    periodEnd: to,
    onDate: on,
  });

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/costs" className="text-[14px] font-semibold text-brand-primary">
        ← Costs
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-text-primary">Record a cost</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        A wage, a bill, a hire — anything the farm paid for that no other screen already
        records. Feed and treatments are charged to flocks automatically as they are issued.
      </p>

      <div className="mt-8">
        <AllocationForm
          today={iso(startOfDay(today))}
          dates={{ on: iso(on), from: iso(from), to: iso(to) }}
          candidates={candidates.map((c) => ({
            flockId: c.flockId,
            label: c.label,
            code: c.code,
            siteName: c.siteName,
            birdDays: c.birdDays,
            headcount: c.headcount,
            closed: c.closedAt !== null,
          }))}
        />
      </div>
    </main>
  );
}

function parseDate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function firstOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
