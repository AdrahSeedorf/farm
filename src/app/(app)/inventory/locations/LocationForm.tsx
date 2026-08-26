'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { createStockLocation, type FormState } from '../actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Add store'}
    </Button>
  );
}

export function LocationForm({ sites }: { sites: { id: string; name: string }[] }) {
  const [state, formAction] = useActionState(createStockLocation, {} as FormState);
  const e = state.fieldErrors ?? {};

  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormError message={state.error} />
      {state.ok ? (
        <p
          role="status"
          className="rounded-control border border-border-strong bg-surface-sunken px-3 py-2.5 text-sm font-medium text-text-primary"
        >
          {state.ok}
        </p>
      ) : null}

      <Field label="Farm" htmlFor="siteId" required error={e.siteId}>
        <Select
          id="siteId"
          name="siteId"
          value={siteId}
          onChange={(ev) => setSiteId(ev.target.value)}
          error={e.siteId}
          required
        >
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Store name" htmlFor="name" required error={e.name}>
        <TextInput
          id="name"
          name="name"
          value={name}
          onChange={(ev) => setName(ev.target.value)}
          placeholder="Feed store"
          error={e.name}
          required
        />
      </Field>

      <Field
        label="Code"
        htmlFor="code"
        required
        error={e.code}
        hint="Short reference used on movement records."
      >
        <TextInput
          id="code"
          name="code"
          value={code}
          onChange={(ev) => setCode(ev.target.value.toUpperCase())}
          placeholder="FEED"
          error={e.code}
          required
          autoCapitalize="characters"
        />
      </Field>

      <Submit />
    </form>
  );
}
