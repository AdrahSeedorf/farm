'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { CUSTOMER_KINDS, KIND_LABELS, KIND_HINTS, type CustomerKind } from '@/lib/customers';
import { saveCustomer, archive, restore, convertEnquiry, type CustomerFormState } from './actions';

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

export function CustomerForm({
  customerId,
  defaults,
  fromEnquiryId,
}: {
  customerId: string | null;
  defaults: {
    kind: CustomerKind;
    name: string;
    phone: string;
    businessName: string;
    email: string;
    town: string;
    notes: string;
  };
  fromEnquiryId?: string;
}) {
  const [state, formAction] = useActionState(
    saveCustomer.bind(null, customerId),
    {} as CustomerFormState,
  );
  const [kind, setKind] = useState<string>(defaults.kind);
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {fromEnquiryId ? (
        <input type="hidden" name="fromEnquiryId" value={fromEnquiryId} />
      ) : null}
      <FormError message={state.error} />

      {/* A DUPLICATE IS INFORMATION, NOT A FAILURE. The row is already saved;
          this names who else holds the number and offers to open them. */}
      {state.duplicateOf ? (
        <div
          role="alert"
          className="rounded-control border border-status-attention bg-status-attention-bg px-3.5 py-3"
        >
          <p className="text-[14px] font-medium text-status-attention">
            {state.duplicateOf.message}
          </p>
          <Link
            href={`/customers/${state.duplicateOf.customerId}`}
            className="mt-2 inline-block text-[14px] font-semibold text-brand-primary hover:underline"
          >
            Open the buyer already on that number →
          </Link>
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name" htmlFor="name" required error={e.name}>
          <TextInput
            id="name"
            name="name"
            defaultValue={defaults.name}
            autoComplete="off"
            error={e.name}
          />
        </Field>

        <Field
          label="Phone"
          htmlFor="phone"
          required
          error={e.phone}
          hint="However you write it — 024…, +233… or with spaces."
        >
          <TextInput
            id="phone"
            name="phone"
            type="tel"
            defaultValue={defaults.phone}
            placeholder="024 123 4567"
            error={e.phone}
          />
        </Field>
      </div>

      <Field
        label="What kind of buyer"
        htmlFor="kind"
        required
        error={e.kind}
        hint={KIND_HINTS[(kind as CustomerKind) ?? 'RETAIL']}
      >
        <Select id="kind" name="kind" value={kind} onChange={(ev) => setKind(ev.target.value)}>
          {CUSTOMER_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Business name" htmlFor="businessName" error={e.businessName}>
          <TextInput
            id="businessName"
            name="businessName"
            defaultValue={defaults.businessName}
            error={e.businessName}
          />
        </Field>

        <Field label="Town" htmlFor="town" error={e.town} hint="Where you would tell a driver.">
          <TextInput id="town" name="town" defaultValue={defaults.town} error={e.town} />
        </Field>
      </div>

      <Field label="Email" htmlFor="email" error={e.email}>
        <TextInput
          id="email"
          name="email"
          type="email"
          defaultValue={defaults.email}
          error={e.email}
        />
      </Field>

      <Field
        label="Notes"
        htmlFor="notes"
        error={e.notes}
        hint="Anything the next person to serve them should know."
      >
        <textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={defaults.notes}
          className="w-full rounded-control border border-border-strong bg-surface-card px-3 py-2.5 text-[16px] text-text-primary outline-none transition-colors focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
        />
      </Field>

      <div className="flex items-center gap-3 pt-1">
        <Submit label={customerId ? 'Save changes' : 'Add buyer'} busy="Saving…" />
        <Link
          href={customerId ? `/customers/${customerId}` : '/customers'}
          className="inline-flex min-h-touch items-center rounded-control px-4 text-[15px] font-semibold text-text-secondary hover:text-text-primary"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

/**
 * NO SUCCESS MESSAGE on these three, for the reason now written down in three
 * other files: each one changes the row it lives in, so the component is
 * unmounted before any confirmation could render. The outcome is the page
 * visibly changing.
 */
export function ArchiveForm({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(
    archive.bind(null, customerId),
    {} as CustomerFormState,
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-touch rounded-control px-3 text-[13px] font-semibold text-text-secondary hover:text-text-primary"
      >
        Put aside
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-3 w-full space-y-3">
      <FormError message={state.error} />
      <Field
        label="Why?"
        htmlFor={`reason-${customerId}`}
        required
        error={state.fieldErrors?.reason}
        hint="They stay on the record — this only takes them off the pickers."
      >
        <TextInput
          id={`reason-${customerId}`}
          name="reason"
          placeholder="Closed the shop"
          error={state.fieldErrors?.reason}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Submit label="Put aside" busy="…" />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-touch rounded-control px-3 text-[13px] font-semibold text-text-secondary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function RestoreForm({ customerId }: { customerId: string }) {
  const [state, formAction] = useActionState(
    restore.bind(null, customerId),
    {} as CustomerFormState,
  );
  return (
    <form action={formAction}>
      <FormError message={state.error} />
      <Submit label="Bring back" busy="…" />
    </form>
  );
}

export function ConvertEnquiryForm({ enquiryId }: { enquiryId: string }) {
  const [state, formAction] = useActionState(
    convertEnquiry.bind(null, enquiryId),
    {} as CustomerFormState,
  );
  return (
    <form action={formAction} className="inline">
      <FormError message={state.error} />
      <button
        type="submit"
        className="min-h-touch rounded-control border border-border-strong bg-surface-card px-3 text-[13px] font-semibold text-text-primary hover:bg-surface-sunken"
      >
        Add as a buyer
      </button>
    </form>
  );
}
