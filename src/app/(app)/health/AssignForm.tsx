'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, Select, FormError, Button } from '@/components/ui/form';
import { assignProgramme, type HealthFormState } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </Button>
  );
}

/**
 * Put a flock on a programme.
 *
 * The picker says how many entries each programme has and whether a vet has
 * reviewed it, because "Layer programme 2026" alone tells you nothing about
 * whether choosing it will actually produce any reminders.
 */
export function AssignForm({
  flockId,
  current,
  programmes,
}: {
  flockId: string;
  current: string | null;
  programmes: { id: string; name: string; status: string; itemCount: number }[];
}) {
  const [state, formAction] = useActionState(
    assignProgramme.bind(null, flockId),
    {} as HealthFormState,
  );
  const [value, setValue] = useState(current ?? '');

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

      <Field label="Health programme" htmlFor="healthProgrammeId">
        <Select
          id="healthProgrammeId"
          name="healthProgrammeId"
          value={value}
          onChange={(ev) => setValue(ev.target.value)}
        >
          <option value="">No programme</option>
          {programmes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.itemCount} entr{p.itemCount === 1 ? 'y' : 'ies'}
              {p.status === 'DRAFT' ? ', not vet-reviewed' : ''}
            </option>
          ))}
        </Select>
      </Field>

      <Submit />
    </form>
  );
}
