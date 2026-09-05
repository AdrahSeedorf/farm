'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { GHANA_REGIONS } from '@/lib/ghana';
import { ITEM_CATEGORIES, CATEGORY_META } from '@/lib/validation/item';
import type { SupplierFormState } from './actions';

/**
 * Adding and editing a supplier.
 *
 * Two things here are deliberate and worth not undoing:
 *
 *   1. The lead-time box is ALLOWED TO BE EMPTY, and empty means something —
 *      "use the farm's own figure". A mill two weeks out and a shop that
 *      delivers next morning must not be forced to share one number, but nor
 *      should every supplier have to be given one before it can be saved.
 *
 *   2. The "supplies" boxes carry no name of their own. React 19 resets a
 *      form's DOM after a server action returns, and a checkbox is not restored
 *      from its React value — so the visible boxes are for the person and the
 *      hidden inputs are what is actually submitted. See ui/form.tsx Select for
 *      the same problem in a dropdown, and what it cost to find.
 */

interface SupplierFormProps {
  action: (prev: SupplierFormState, formData: FormData) => Promise<SupplierFormState>;
  defaults?: {
    name?: string;
    contactName?: string | null;
    phone?: string | null;
    altPhone?: string | null;
    email?: string | null;
    town?: string | null;
    district?: string | null;
    region?: string | null;
    supplies?: string[];
    leadTimeDays?: number | null;
    paymentTerms?: string | null;
    notes?: string | null;
  };
  /** The farm-wide figure, shown so a blank box reads as a decision. */
  farmLeadTimeDays: number;
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

export function SupplierForm({
  action,
  defaults = {},
  farmLeadTimeDays,
  submitLabel,
  cancelHref,
}: SupplierFormProps) {
  const [state, formAction] = useActionState(action, {} as SupplierFormState);
  const [supplies, setSupplies] = useState<string[]>(defaults.supplies ?? []);
  const e = state.fieldErrors ?? {};

  const toggle = (category: string) =>
    setSupplies((current) =>
      current.includes(category)
        ? current.filter((c) => c !== category)
        : [...current, category],
    );

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <FormError message={state.error} />
      {state.ok ? (
        <p
          role="status"
          className="rounded-control border border-border-strong bg-surface-sunken px-3 py-2.5 text-sm font-medium text-text-primary"
        >
          {state.ok}
        </p>
      ) : null}

      <Field label="Supplier name" htmlFor="name" required error={e.name}>
        <TextInput
          id="name"
          name="name"
          defaultValue={defaults.name}
          placeholder="Ashanti Feed Mill"
          error={e.name}
          required
        />
      </Field>

      <Field
        label="Person you deal with"
        htmlFor="contactName"
        error={e.contactName}
        hint="Whoever actually answers the phone."
      >
        <TextInput
          id="contactName"
          name="contactName"
          defaultValue={defaults.contactName ?? ''}
          error={e.contactName}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Phone"
          htmlFor="phone"
          error={e.phone}
          hint="Any way you write it. 024… or +233…"
        >
          <TextInput
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={defaults.phone ?? ''}
            placeholder="024 123 4567"
            error={e.phone}
          />
        </Field>
        <Field label="Second phone" htmlFor="altPhone" error={e.altPhone}>
          <TextInput
            id="altPhone"
            name="altPhone"
            type="tel"
            inputMode="tel"
            defaultValue={defaults.altPhone ?? ''}
            error={e.altPhone}
          />
        </Field>
      </div>

      <Field label="Email" htmlFor="email" error={e.email}>
        <TextInput
          id="email"
          name="email"
          type="email"
          inputMode="email"
          defaultValue={defaults.email ?? ''}
          error={e.email}
          autoCapitalize="none"
        />
      </Field>

      <fieldset>
        <legend className="text-sm font-semibold text-text-primary">What they supply</legend>
        <p className="mt-0.5 text-[13px] text-text-muted">
          Used to put the right suppliers in front of you when ordering. Tick as many as
          apply — nothing here stops you buying anything else from them.
        </p>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
          {ITEM_CATEGORIES.map((category) => {
            const checked = supplies.includes(category);
            return (
              <label
                key={category}
                className={`flex min-h-touch items-center gap-3 rounded-control border p-3 transition-colors ${
                  checked
                    ? 'border-brand-primary bg-brand-primary-soft'
                    : 'border-border-default bg-surface-card'
                }`}
              >
                {/* No name — the hidden inputs below are what gets submitted. */}
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(category)}
                  aria-label={CATEGORY_META[category].label}
                  className="h-5 w-5 shrink-0 rounded border-border-strong accent-brand-primary"
                />
                <span className="text-[14px] font-medium text-text-primary">
                  {CATEGORY_META[category].label}
                </span>
              </label>
            );
          })}
        </div>
        {supplies.map((category) => (
          <input key={category} type="hidden" name="supplies" value={category} />
        ))}
      </fieldset>

      <Field
        label="How many days they take"
        htmlFor="leadTimeDays"
        error={e.leadTimeDays}
        hint={`Leave blank to use the farm’s figure of ${farmLeadTimeDays} day${
          farmLeadTimeDays === 1 ? '' : 's'
        }. This is what tells you when stock cover runs out before a delivery could arrive.`}
      >
        <TextInput
          id="leadTimeDays"
          name="leadTimeDays"
          type="number"
          inputMode="numeric"
          min={0}
          max={365}
          step={1}
          defaultValue={defaults.leadTimeDays ?? ''}
          placeholder={String(farmLeadTimeDays)}
          error={e.leadTimeDays}
        />
      </Field>

      <Field
        label="Payment terms"
        htmlFor="paymentTerms"
        error={e.paymentTerms}
        hint="In your own words — “cash on delivery”, “MoMo before loading”, “30 days”."
      >
        <TextInput
          id="paymentTerms"
          name="paymentTerms"
          defaultValue={defaults.paymentTerms ?? ''}
          placeholder="Cash on delivery"
          error={e.paymentTerms}
        />
      </Field>

      <Field label="Region" htmlFor="region" error={e.region}>
        <Select id="region" name="region" defaultValue={defaults.region ?? ''} error={e.region}>
          <option value="">Select a region</option>
          {GHANA_REGIONS.map((region) => (
            <option key={region} value={region}>
              {region}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="District" htmlFor="district" error={e.district}>
          <TextInput
            id="district"
            name="district"
            defaultValue={defaults.district ?? ''}
            error={e.district}
          />
        </Field>
        <Field label="Town" htmlFor="town" error={e.town}>
          <TextInput id="town" name="town" defaultValue={defaults.town ?? ''} error={e.town} />
        </Field>
      </div>

      <Field
        label="Notes"
        htmlFor="notes"
        error={e.notes}
        hint="Anything the next person should know. Directions, who to ask for, what went wrong last time."
      >
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={defaults.notes ?? ''}
          className="w-full rounded-control border border-border-strong bg-surface-card px-3 py-2.5 text-[16px] text-text-primary outline-none transition-colors focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
        />
      </Field>

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
