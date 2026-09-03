'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, FormError, Button } from '@/components/ui/form';
import { addBreed } from './actions';
import type { FormState } from '../sites/actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Adding…' : 'Add breed'}
    </Button>
  );
}

/**
 * Add a breed the catalogue does not already carry.
 *
 * Adds the NAME only. The weight table is loaded separately from the breeder's
 * management guide, because a curve typed in by hand is a curve nobody can trace
 * back to a source.
 */
export function BreedForm() {
  const [state, formAction] = useActionState(addBreed, {} as FormState);
  const e = state.fieldErrors ?? {};
  const [name, setName] = useState('');
  const [supplier, setSupplier] = useState('');

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormError message={state.error} />
      {state.ok ? (
        <p
          role="status"
          className="rounded-control border border-border-strong bg-surface-sunken px-3 py-2.5 text-sm font-medium text-text-primary"
        >
          {state.ok}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Breed name" htmlFor="breed-name" required error={e.name}>
          <TextInput
            id="breed-name"
            name="name"
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            placeholder="Shaver Brown"
            error={e.name}
            required
          />
        </Field>
        <Field label="Breeder" htmlFor="breed-supplier" error={e.supplier}>
          <TextInput
            id="breed-supplier"
            name="supplier"
            value={supplier}
            onChange={(ev) => setSupplier(ev.target.value)}
            placeholder="Hendrix Genetics"
            error={e.supplier}
          />
        </Field>
      </div>

      <Submit />
    </form>
  );
}
