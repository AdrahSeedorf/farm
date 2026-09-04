'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, FormError, Button } from '@/components/ui/form';
import { updateDowntime, type BiosecurityFormState } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? 'Saving…' : 'Set the rule'}
    </Button>
  );
}

/**
 * Set or clear a farm's downtime rule.
 *
 * The blank is a real answer, not an unfinished form: clearing it puts the
 * visitor log back to reporting elapsed time without passing a verdict, which
 * is a legitimate thing for a farm to want.
 */
export function DowntimeForm({
  siteId,
  siteName,
  current,
}: {
  siteId: string;
  siteName: string;
  current: number | null;
}) {
  const [state, formAction] = useActionState(
    updateDowntime.bind(null, siteId),
    {} as BiosecurityFormState,
  );
  const [hours, setHours] = useState(current === null ? '' : String(current));

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3" noValidate>
      <FormError message={state.error} />
      <div className="min-w-[12rem] flex-1">
        <Field
          label={`${siteName} — hours clear of other poultry`}
          htmlFor={`downtime-${siteId}`}
          error={state.fieldErrors?.visitorDowntimeHours}
          hint="Blank means no rule, and no verdict."
        >
          <TextInput
            id={`downtime-${siteId}`}
            name="visitorDowntimeHours"
            type="number"
            inputMode="numeric"
            min="1"
            max="336"
            placeholder="—"
            value={hours}
            onChange={(ev) => setHours(ev.target.value)}
            error={state.fieldErrors?.visitorDowntimeHours}
          />
        </Field>
      </div>
      <Submit />
      {state.ok ? (
        <p role="status" className="w-full text-[13px] text-text-secondary">
          {state.ok}
        </p>
      ) : null}
    </form>
  );
}
