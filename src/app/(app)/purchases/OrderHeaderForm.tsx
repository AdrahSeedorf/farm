'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import type { OrderFormState } from './actions';

/**
 * The header of an order: who, where, when.
 *
 * THE DELIVERY DATE IS SUGGESTED, NEVER ASSERTED. Choosing a supplier fills the
 * date in from that supplier's lead time and says where the figure came from,
 * in a field somebody can overwrite. The lead time is an average of past
 * experience; this supplier on this week may be quicker or slower, and only the
 * person on the phone knows which.
 */

export interface SupplierOption {
  id: string;
  name: string;
  effectiveLeadTimeDays: number;
  usingFarmDefault: boolean;
}

interface Props {
  action: (prev: OrderFormState, formData: FormData) => Promise<OrderFormState>;
  sites: { id: string; name: string }[];
  suppliers: SupplierOption[];
  defaults?: {
    siteId?: string;
    supplierId?: string;
    orderedOn?: string;
    expectedOn?: string | null;
    notes?: string | null;
  };
  /** Supplier and site are fixed once the order has been sent. */
  locked?: boolean;
  today: string;
  submitLabel: string;
  cancelHref: string;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function OrderHeaderForm({
  action,
  sites,
  suppliers,
  defaults = {},
  locked = false,
  today,
  submitLabel,
  cancelHref,
}: Props) {
  const [state, formAction] = useActionState(action, {} as OrderFormState);
  const [siteId, setSiteId] = useState(defaults.siteId ?? sites[0]?.id ?? '');
  const [supplierId, setSupplierId] = useState(defaults.supplierId ?? '');
  const [orderedOn, setOrderedOn] = useState(defaults.orderedOn ?? today);
  const [expectedOn, setExpectedOn] = useState(defaults.expectedOn ?? '');
  // Only true once the person has actually typed a date of their own. Their
  // choice is never overwritten by a later supplier change.
  const [dateIsTheirs, setDateIsTheirs] = useState(Boolean(defaults.expectedOn));

  const e = state.fieldErrors ?? {};
  const supplier = suppliers.find((s) => s.id === supplierId) ?? null;

  function chooseSupplier(id: string) {
    setSupplierId(id);
    const chosen = suppliers.find((s) => s.id === id);
    if (chosen && !dateIsTheirs) setExpectedOn(addDays(orderedOn, chosen.effectiveLeadTimeDays));
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormError message={state.error} />

      <Field label="Supplier" htmlFor="supplierId" required error={e.supplierId}>
        <Select
          id="supplierId"
          name="supplierId"
          value={supplierId}
          onChange={(ev) => chooseSupplier(ev.target.value)}
          error={e.supplierId}
          disabled={locked}
        >
          <option value="">Choose a supplier</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Delivering to" htmlFor="siteId" required error={e.siteId}>
        <Select
          id="siteId"
          name="siteId"
          value={siteId}
          onChange={(ev) => setSiteId(ev.target.value)}
          error={e.siteId}
          disabled={locked}
        >
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Ordered on" htmlFor="orderedOn" required error={e.orderedOn}>
          <TextInput
            id="orderedOn"
            name="orderedOn"
            type="date"
            max={today}
            value={orderedOn}
            onChange={(ev) => setOrderedOn(ev.target.value)}
            error={e.orderedOn}
          />
        </Field>

        <Field
          label="Promised for"
          htmlFor="expectedOn"
          error={e.expectedOn}
          hint={
            supplier
              ? `${supplier.name} usually takes ${supplier.effectiveLeadTimeDays} day${
                  supplier.effectiveLeadTimeDays === 1 ? '' : 's'
                }${supplier.usingFarmDefault ? ' (the farm’s figure)' : ''}. Change this to the date they actually promised.`
              : 'The date the supplier actually promised. Lateness is measured against this and nothing else.'
          }
        >
          <TextInput
            id="expectedOn"
            name="expectedOn"
            type="date"
            value={expectedOn}
            onChange={(ev) => {
              setExpectedOn(ev.target.value);
              setDateIsTheirs(true);
            }}
            error={e.expectedOn}
          />
        </Field>
      </div>

      <Field
        label="Notes"
        htmlFor="notes"
        error={e.notes}
        hint="Who you spoke to, what was agreed on the phone, anything the person receiving it should know."
      >
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={defaults.notes ?? ''}
          className="w-full rounded-control border border-border-strong bg-surface-card px-3 py-2.5 text-[16px] text-text-primary outline-none transition-colors focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
        />
      </Field>

      {locked ? (
        <p className="rounded-control border border-border-default bg-surface-sunken px-3.5 py-2.5 text-[13px] text-text-secondary">
          The supplier and the farm cannot be changed now that the order has been sent —
          the number has already been quoted to them.
        </p>
      ) : null}

      <div className="flex items-center gap-3 pt-1">
        <Submit label={submitLabel} />
        <Link
          href={cancelHref}
          className="inline-flex min-h-touch items-center rounded-control px-4 text-[15px] font-semibold text-text-secondary hover:text-text-primary"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
