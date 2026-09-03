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
  defaults: { name: string; legalName: string | null; stockLeadTimeDays: number };
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
      <Submit />
    </form>
  );
}
