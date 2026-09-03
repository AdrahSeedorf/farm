'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, FormError, Button } from '@/components/ui/form';
import type { FormState } from '../sites/actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </Button>
  );
}

export function OrganisationForm({
  action,
  defaults,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults: {
    name: string;
    legalName: string | null;
    stockLeadTimeDays: number;
    pulletMarketPrice: string;
    pulletMarketPriceOn: string;
    pulletMarketPriceSource: string;
  };
}) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormError message={state.error} />
      <Field label="Business name" htmlFor="org-name" required error={e.name}>
        <TextInput
          id="org-name"
          name="name"
          defaultValue={defaults.name}
          error={e.name}
          required
        />
      </Field>
      <Field
        label="Registered legal name"
        htmlFor="org-legal"
        error={e.legalName}
        hint="As registered — appears on invoices and formal documents."
      >
        <TextInput
          id="org-legal"
          name="legalName"
          defaultValue={defaults.legalName ?? ''}
          placeholder="ADRAH Farms Ltd"
          error={e.legalName}
        />
      </Field>
      <Field
        label="Stock lead time"
        htmlFor="org-lead-time"
        error={e.stockLeadTimeDays}
        hint="Days between placing an order and it arriving. Every days-of-cover warning is measured against this — four days of feed is comfortable with a next-day supplier and an emergency with a fortnightly one."
      >
        <TextInput
          id="org-lead-time"
          name="stockLeadTimeDays"
          type="number"
          inputMode="numeric"
          min="0"
          max="365"
          defaultValue={String(defaults.stockLeadTimeDays ?? 7)}
          error={e.stockLeadTimeDays}
        />
      </Field>

      {/*
        The one number in this system that comes from OUTSIDE the farm.
        Everything else on a costing screen is derived from what was recorded
        here; this is a market fact, it moves with the season and the supplier,
        and nothing can work it out. So it is asked for, dated, and left blank
        until someone has a real quote — the rear-or-buy comparison simply does
        not appear until then.
      */}
      <fieldset className="rounded-card border border-border-default bg-surface-sunken p-4">
        <legend className="px-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-accent">
          Ready-to-lay pullet price
        </legend>
        <p className="mt-2 text-[13px] text-text-secondary">
          What a point-of-lay pullet would cost you to buy today. Used for one thing: to
          compare against what rearing your own actually cost. Leave it blank and the
          comparison is not shown — a guessed price would be worse than none.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Price each (GHS)" htmlFor="org-pullet-price" error={e.pulletMarketPrice}>
            <TextInput
              id="org-pullet-price"
              name="pulletMarketPrice"
              inputMode="decimal"
              placeholder="75.00"
              defaultValue={defaults.pulletMarketPrice}
              error={e.pulletMarketPrice}
            />
          </Field>
          <Field
            label="Quoted on"
            htmlFor="org-pullet-date"
            error={e.pulletMarketPriceOn}
            hint="Required if you enter a price."
          >
            <TextInput
              id="org-pullet-date"
              name="pulletMarketPriceOn"
              type="date"
              defaultValue={defaults.pulletMarketPriceOn}
              error={e.pulletMarketPriceOn}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field
            label="Who quoted it"
            htmlFor="org-pullet-source"
            error={e.pulletMarketPriceSource}
            hint="A hatchery, a trader, the market at Adansi."
          >
            <TextInput
              id="org-pullet-source"
              name="pulletMarketPriceSource"
              defaultValue={defaults.pulletMarketPriceSource}
              error={e.pulletMarketPriceSource}
            />
          </Field>
        </div>
      </fieldset>

      <Submit />
    </form>
  );
}
