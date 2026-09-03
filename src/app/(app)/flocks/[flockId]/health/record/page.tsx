import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { canAccessSite } from '@/lib/scope';
import { recordContext } from '@/lib/health-event-service';
import { requiredQuantity } from '@/lib/health-schedule';
import { RecordForm } from '../../../../health/RecordForm';

export const metadata: Metadata = { title: 'Record a health event' };

export default async function RecordHealthPage({
  params,
  searchParams,
}: {
  params: Promise<{ flockId: string }>;
  searchParams: Promise<{ item?: string }>;
}) {
  const { principal, allowed } = await pageGuard('health:create');
  if (!allowed) return <Forbidden area="health records" roles={principal.roles} />;

  const { flockId } = await params;
  const { item: programmeItemId } = await searchParams;

  const context = await recordContext(principal, flockId, programmeItemId);
  if (!context) notFound();
  if (!canAccessSite(principal, context.flock.siteId)) notFound();

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);

  const planned = context.planned;

  /**
   * Prefilled from the plan, and every field still editable.
   *
   * The quantity is birds × the planned dose, NOT rounded up to a whole vial.
   * A 1,000-dose vial opened for 940 birds leaves 60 doses that are in practice
   * discarded — but that is waste, and it belongs in the waste figures rather
   * than buried in this flock's treatment cost as though the birds received it.
   */
  const suggestedQuantity = planned
    ? requiredQuantity(context.population, planned.dosePerBird)
    : null;

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link
        href={`/flocks/${flockId}/health`}
        className="text-[14px] font-semibold text-brand-primary"
      >
        ← {context.flock.code} health
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">
        {planned ? planned.name : 'Record a health event'}
      </h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        {planned
          ? `Planned for day ${planned.ageDays}. Everything below is prefilled from the programme and can be changed — record what actually happened.`
          : 'Anything given outside the programme — an outbreak treatment, a vet visit, a post-mortem.'}
      </p>

      <div className="mt-7 rounded-card border border-border-default bg-surface-card p-5 sm:p-6">
        <RecordForm
          flockId={flockId}
          cancelHref={`/flocks/${flockId}/health`}
          today={today}
          items={context.items}
          locations={context.locations}
          defaults={{
            programmeItemId: planned?.id ?? null,
            name: planned?.name ?? '',
            type: planned?.eventType ?? 'VACCINATION',
            route: planned?.route ?? '',
            itemId: planned?.itemId ?? '',
            quantityBase: suggestedQuantity === null ? '' : String(suggestedQuantity),
            birdsTreated: context.population > 0 ? String(context.population) : '',
            eggWithdrawalDays:
              planned?.eggWithdrawalDays === null || planned?.eggWithdrawalDays === undefined
                ? ''
                : String(planned.eggWithdrawalDays),
            meatWithdrawalDays:
              planned?.meatWithdrawalDays === null || planned?.meatWithdrawalDays === undefined
                ? ''
                : String(planned.meatWithdrawalDays),
          }}
        />
      </div>
    </main>
  );
}
