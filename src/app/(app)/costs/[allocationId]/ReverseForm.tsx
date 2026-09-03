'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, FormError, Button } from '@/components/ui/form';
import { reverseCost, type CostFormState } from '../actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" disabled={pending}>
      {pending ? 'Reversing…' : 'Reverse this cost'}
    </Button>
  );
}

/**
 * The reason is required, and it is required in a text box rather than a
 * dropdown on purpose. "Wrong month" and "paid by the landlord, not the farm"
 * are both real reasons and no list would have held the second one.
 */
export function ReverseForm({ allocationId }: { allocationId: string }) {
  const [state, formAction] = useActionState(
    reverseCost.bind(null, allocationId),
    {} as CostFormState,
  );
  const [reason, setReason] = useState('');

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormError message={state.error} />
      <Field
        label="Why"
        htmlFor="reason"
        required
        error={state.fieldErrors?.reason}
        hint="Stays on the record beside the reversal."
      >
        <TextInput
          id="reason"
          name="reason"
          value={reason}
          onChange={(ev) => setReason(ev.target.value)}
          error={state.fieldErrors?.reason}
          required
        />
      </Field>
      <Submit />
    </form>
  );
}
