import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { supplierById } from '@/lib/supplier-service';
import { CATEGORY_META, type ItemCategory } from '@/lib/validation/item';
import { SupplierArchiveToggle } from '../SupplierArchiveToggle';

export const metadata: Metadata = { title: 'Supplier' };

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px] text-text-primary">{children}</dd>
    </div>
  );
}

export default async function SupplierPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const { supplierId } = await params;
  const { principal, allowed } = await pageGuard('supplier:view');
  if (!allowed) return <Forbidden area="suppliers" roles={principal.roles} />;

  const supplier = await supplierById(principal, supplierId);
  if (!supplier) notFound();

  const canEdit = await currentUserCan('supplier:edit');

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/suppliers" className="text-[14px] font-semibold text-brand-primary">
        ← Suppliers
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{supplier.name}</h1>
          <p className="mt-1 flex items-center gap-2 text-[14px] text-text-secondary">
            <span className="rounded bg-brand-primary-soft px-2 py-0.5 font-mono text-[12px] font-semibold text-brand-primary">
              {supplier.code}
            </span>
            {supplier.isActive ? null : <span className="font-semibold">Archived</span>}
          </p>
        </div>
        {canEdit ? (
          <Link
            href={`/suppliers/${supplier.id}/edit`}
            className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-5 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
          >
            Edit
          </Link>
        ) : null}
      </div>

      {/* Reaching them comes first. This is the screen somebody opens standing
          in the store with an empty feed pallet. */}
      <section className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <h2 className="text-lg font-semibold text-text-primary">Getting hold of them</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Detail label="Person">{supplier.contactName ?? 'Not recorded'}</Detail>
          <Detail label="Phone">
            {supplier.telHref ? (
              <a href={supplier.telHref} className="font-semibold text-brand-primary">
                {supplier.phoneDisplay}
              </a>
            ) : (
              (supplier.phoneDisplay ?? 'Not recorded')
            )}
          </Detail>
          <Detail label="Second phone">{supplier.altPhoneDisplay ?? 'Not recorded'}</Detail>
          <Detail label="Email">{supplier.email ?? 'Not recorded'}</Detail>
          <Detail label="Where they are">{supplier.place ?? 'Not recorded'}</Detail>
        </dl>

        {supplier.whatsappHref ? (
          <a
            href={supplier.whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
          >
            Message on WhatsApp
          </a>
        ) : supplier.phone ? (
          <p className="mt-5 text-[13px] text-text-muted">
            That number is kept as it was typed, but it is not a number WhatsApp can open.
            Check the digits if you expected a link here.
          </p>
        ) : null}
      </section>

      <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
        <h2 className="text-lg font-semibold text-text-primary">Buying from them</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Detail label="How long they take">
            <span className="font-semibold tabular">
              {supplier.effectiveLeadTimeDays} day
              {supplier.effectiveLeadTimeDays === 1 ? '' : 's'}
            </span>
            <span className="mt-0.5 block text-[13px] text-text-muted">
              {supplier.usingFarmDefault
                ? 'The farm’s own figure — this supplier has not been given one of its own.'
                : 'Recorded for this supplier.'}
            </span>
          </Detail>
          <Detail label="Payment terms">{supplier.paymentTerms ?? 'Not agreed'}</Detail>
        </dl>

        <div className="mt-4">
          <p className="text-[13px] text-text-muted">What they supply</p>
          {supplier.supplies.length === 0 ? (
            <p className="mt-0.5 text-[15px] text-text-primary">Not recorded</p>
          ) : (
            <ul className="mt-1.5 flex flex-wrap gap-2">
              {supplier.supplies.map((c) => (
                <li
                  key={c}
                  className="rounded-control border border-border-default bg-surface-sunken px-2.5 py-1 text-[13px] font-medium text-text-primary"
                >
                  {CATEGORY_META[c as ItemCategory]?.label ?? c}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {supplier.notes ? (
        <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
          <h2 className="text-lg font-semibold text-text-primary">Notes</h2>
          <p className="mt-2 whitespace-pre-line text-[15px] text-text-secondary">
            {supplier.notes}
          </p>
        </section>
      ) : null}

      {canEdit ? (
        <section className="mt-6 rounded-card border border-border-default bg-surface-sunken p-6">
          <h2 className="text-[15px] font-semibold text-text-primary">
            {supplier.isActive ? 'Stopped using them?' : 'Using them again?'}
          </h2>
          <p className="mt-1 max-w-lg text-[14px] text-text-secondary">
            {supplier.isActive
              ? 'Archiving takes the name out of the ordering screens. Every past order and delivery stays exactly as it is.'
              : 'Restoring puts the name back into the ordering screens.'}
          </p>
          <div className="mt-4">
            <SupplierArchiveToggle supplierId={supplier.id} isActive={supplier.isActive} />
          </div>
        </section>
      ) : null}
    </main>
  );
}
