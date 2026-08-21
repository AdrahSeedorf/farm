'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, FormError, Button } from '@/components/ui/form';
import type { FormState } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Adding…' : 'Add house'}
    </Button>
  );
}

export function ProductionUnitForm({
  action,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormError message={state.error} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" htmlFor="unit-name" required error={e.name}>
          <TextInput id="unit-name" name="name" placeholder="House A" error={e.name} required />
        </Field>
        <Field label="Code" htmlFor="unit-code" required error={e.code}>
          <TextInput
            id="unit-code"
            name="code"
            placeholder="H-A"
            error={e.code}
            required
            autoCapitalize="characters"
          />
        </Field>
        <Field
          label="Capacity"
          htmlFor="unit-capacity"
          error={e.capacity}
          hint="Birds. Advisory only."
        >
          <TextInput
            id="unit-capacity"
            name="capacity"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="1250"
            error={e.capacity}
          />
        </Field>
      </div>
      <Submit />
    </form>
  );
}
