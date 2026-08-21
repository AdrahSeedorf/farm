'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import type { FormState } from '../sites/actions';

interface ReasonOption {
  key: string;
  label: string;
  appliesTo: string[];
  hint?: string;
}

const TYPES = [
  { value: 'MORTALITY', label: 'Mortality' },
  { value: 'CULL', label: 'Cull' },
  { value: 'SALE', label: 'Sale' },
  { value: 'TRANSFER_OUT', label: 'Transfer out' },
  { value: 'ADJUSTMENT', label: 'Correction' },
] as const;

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Recording…' : 'Record'}
    </Button>
  );
}

export function EventForm({
  action,
  reasons,
  today,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  reasons: ReasonOption[];
  today: string;
}) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const [type, setType] = useState<string>('MORTALITY');
  const e = state.fieldErrors ?? {};

  const applicable = reasons.filter((r) => r.appliesTo.includes(type));
  const isCorrection = type === 'ADJUSTMENT';

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormError message={state.error} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="What happened" htmlFor="type" required error={e.type}>
          <Select
            id="type"
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value)}
            error={e.type}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={isCorrection ? 'Difference' : 'Number of birds'}
          htmlFor="quantity"
          required
          error={e.quantity}
          hint={isCorrection ? 'Negative to reduce, positive to increase.' : undefined}
        >
          <TextInput
            id="quantity"
            name="quantity"
            type="number"
            inputMode="numeric"
            step={1}
            min={isCorrection ? undefined : 1}
            placeholder={isCorrection ? '-3' : '4'}
            error={e.quantity}
            required
          />
        </Field>

        <Field label="Date" htmlFor="occurredOn" required error={e.occurredOn}>
          <TextInput
            id="occurredOn"
            name="occurredOn"
            type="date"
            defaultValue={today}
            max={today}
            error={e.occurredOn}
            required
          />
        </Field>
      </div>

      <Field
        label="Reason"
        htmlFor="reasonCode"
        required={isCorrection}
        error={e.reasonCode}
        hint={
          isCorrection
            ? 'A correction never rewrites history — it adds an offsetting event.'
            : 'Counting needs a code. Anything a code cannot hold goes in the note.'
        }
      >
        <Select id="reasonCode" name="reasonCode" error={e.reasonCode}>
          <option value="">{isCorrection ? 'Choose a reason' : 'Not specified'}</option>
          {applicable.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Note" htmlFor="notes" error={e.notes}>
        <TextInput
          id="notes"
          name="notes"
          placeholder="Anything worth remembering about this"
          error={e.notes}
        />
      </Field>

      <Submit />
    </form>
  );
}
