import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { customerById } from '@/lib/customer-service';
import { listOrders } from '@/lib/sales-service';
import { sortOrders, committedSentence, STATE_LABELS } from '@/lib/sales';
import { formatGHS } from '@/lib/money';
import { displayName, isArchived, KIND_LABELS } from '@/lib/customers';
import { formatGhanaPhone, telLink } from '@/lib/brand';
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
  const [customer, canEdit, canSeeOrders] = await Promise.all([
    customerById(principal, customerId),
    currentUserCan('customer:edit'),
    currentUserCan('order:view'),
  ]);
  if (!customer) notFound();

  const orders = canSeeOrders
    ? sortOrders(await listOrders(principal, { customerId }))
    : [];

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

      {/* THE STANDING COUNTER ROW IS NOT A PERSON, and must never be offered a
          Call button over an empty number. It is here at all so cash takings at
          the gate add up somewhere the farm can look at. */}
      {customer.isCounterSale ? (
        <section className="mt-7 rounded-card border border-border-strong bg-surface-sunken p-6">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-text-muted">
            Not a person
          </h2>
          <p className="mt-3 text-[15px] text-text-primary">
            Cash sales at the gate to buyers who did not leave a number are recorded here, so
            they add up somewhere honest. There is nobody to ring.
          </p>
        </section>
      ) : (
      /* REACHING THEM IS THE FIRST THING ON THE PAGE. Whoever opened this record
         is almost always about to ring or message them, and on a phone that
         should be one tap rather than a number to copy out. */
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
      )}

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

      {/* WHAT WAS AGREED, AND NOT CALLED A BALANCE. A balance is what is owed,
          and that needs payments, which are not recorded anywhere yet. Putting
          the word "balance" on this figure would put a number on a screen that
          a farm would chase somebody for. */}
      {canSeeOrders ? (
        <section className="mt-8 rounded-card border border-border-default bg-surface-card p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
              Orders
            </h2>
            <Link href="/orders/new" className="text-[14px] font-semibold text-brand-primary">
              Take an order
            </Link>
          </div>

          <p className="mt-3 text-[15px] text-text-primary">{committedSentence(orders)}</p>

          {orders.length > 0 ? (
            <ul className="mt-4 divide-y divide-border-default">
              {orders.slice(0, 8).map((order) => (
                <li key={order.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2.5">
                  <Link
                    href={`/orders/${order.id}`}
                    className="text-[15px] font-semibold text-text-primary hover:text-brand-primary"
                  >
                    {order.orderNumber}
                    <span className="ml-2 font-normal text-text-muted">
                      {STATE_LABELS[order.state]}
                    </span>
                  </Link>
                  <span className="tabular text-[15px] font-semibold text-text-primary">
                    {formatGHS(order.totalPesewas)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {canEdit && !archived ? (
        <div className="mt-8 border-t border-border-default pt-5">
          <ArchiveForm customerId={customer.id} />
        </div>
      ) : null}
    </main>
  );
}
