import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { customerById } from '@/lib/customer-service';
import { displayName, isArchived, KIND_LABELS } from '@/lib/customers';
import { BRAND, formatGhanaPhone, telLink } from '@/lib/brand';
import { ArchiveForm, RestoreForm } from '../CustomerForms';

export const metadata: Metadata = { title: 'Buyer' };

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { principal, allowed } = await pageGuard('customer:view');
  if (!allowed) return <Forbidden area="buyers" roles={principal.roles} />;

  const { customerId } = await params;
  const [customer, canEdit] = await Promise.all([
    customerById(principal, customerId),
    currentUserCan('customer:edit'),
  ]);
  if (!customer) notFound();

  const archived = isArchived(customer);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/customers" className="text-[14px] font-semibold text-brand-primary">
        ← Buyers
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{displayName(customer)}</h1>
          <p className="mt-1 text-[14px] text-text-secondary">
            {KIND_LABELS[customer.kind]}
            {customer.town ? ` · ${customer.town}` : ''} · added {day(customer.createdAt)}
            {customer.createdByName ? ` by ${customer.createdByName}` : ''}
          </p>
        </div>
        {canEdit && !archived ? (
          <Link
            href={`/customers/${customer.id}/edit`}
            className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-4 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
          >
            Edit
          </Link>
        ) : null}
      </div>

      {archived ? (
        <div className="mt-5 rounded-control border border-border-strong bg-surface-sunken px-4 py-3">
          <p className="text-[14px] font-medium text-text-primary">
            Put aside{customer.archivedByName ? ` by ${customer.archivedByName}` : ''}
            {customer.archivedAt ? ` on ${day(customer.archivedAt)}` : ''}.
            {customer.archiveReason ? ` ${customer.archiveReason}` : ''}
          </p>
          {canEdit ? (
            <div className="mt-3">
              <RestoreForm customerId={customer.id} />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* REACHING THEM IS THE FIRST THING ON THE PAGE. Whoever opened this record
          is almost always about to ring or message them, and on a phone that
          should be one tap rather than a number to copy out. */}
      <section className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
          Reach them
        </h2>
        <p className="mt-3 text-[18px] font-semibold text-text-primary">
          {formatGhanaPhone(customer.phone)}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={telLink(customer.phone)}
            className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-bold text-text-inverse hover:bg-brand-primary-hover"
          >
            Call
          </a>
          <a
            href={`https://wa.me/${customer.phone.replace(/\D/g, '')}`}
            className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-5 text-[15px] font-bold text-text-primary hover:bg-surface-sunken"
          >
            WhatsApp
          </a>
          {customer.email ? (
            <a
              href={`mailto:${customer.email}`}
              className="inline-flex min-h-touch items-center rounded-control px-4 text-[15px] font-semibold text-text-secondary hover:text-text-primary"
            >
              {customer.email}
            </a>
          ) : null}
        </div>
      </section>

      {customer.notes ? (
        <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
            Notes
          </h2>
          <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-text-primary">
            {customer.notes}
          </p>
        </section>
      ) : null}

      {customer.fromEnquiryId ? (
        <p className="mt-6 text-[14px] text-text-secondary">
          Came from{' '}
          <Link href="/enquiries?archived=1" className="font-semibold text-brand-primary hover:underline">
            a website enquiry
          </Link>
          .
        </p>
      ) : null}

      {/* ORDERS AND BALANCES ARE NOT HERE YET, and the page says so rather than
          leaving a silence that reads as "this buyer has never bought anything".
          Those arrive with the rest of Milestone 15. */}
      <section className="mt-8 rounded-card border border-border-default bg-surface-sunken p-6">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-text-muted">
          Orders and balance
        </h2>
        <p className="mt-2 text-[14px] text-text-secondary">
          Not built yet. When selling is in, this is where what {customer.name} has ordered and
          what they owe will sit — {BRAND.name} is not taking orders through this system today,
          so nothing is missing from the record.
        </p>
      </section>

      {canEdit && !archived ? (
        <div className="mt-8 border-t border-border-default pt-5">
          <ArchiveForm customerId={customer.id} />
        </div>
      ) : null}
    </main>
  );
}
