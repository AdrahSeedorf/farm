'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, FormError, Button } from '@/components/ui/form';
import { MAX_PARK_DAYS } from '@/lib/alerts';
import { parkAlert, liftAlert, type AlertFormState } from './actions';

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

function isoIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * "I have this — stop telling us until Thursday."
 *
 * THERE IS NO SUCCESS MESSAGE HERE, AND THAT IS THE FIX, NOT AN OMISSION.
 *
 *   I wrote one first. It never rendered: parking an alert moves it out of the
 *   live list and into the parked section, so the row this form lives in is gone
 *   from the tree before the state it returned can be shown. Eight times in this
 *   codebase a component has been unmounted mid-confirmation; this is the ninth,
 *   and I had written a comment predicting it directly above the bug.
 *
 *   The right answer here is not to keep the form alive to say "done". It is to
 *   notice that the outcome is already on the screen: the alert appears in
 *   Parked below, with who parked it, why, and when it comes back. That is a
 *   better confirmation than a message about a confirmation, because it shows
 *   the actual new state. So this component renders the form and its errors, and
 *   lets the page speak for the success.
 *
 *   `state.error` still renders, because a rejected park leaves the row exactly
 *   where it was and the person needs to be told why.
 */
export function ParkForm({ alertKey }: { alertKey: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(parkAlert, {} as AlertFormState);
  const [note, setNote] = useState('');
  const [until, setUntil] = useState(isoIn(3));

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 min-h-touch rounded-control px-3 text-[13px] font-semibold text-text-secondary hover:text-text-primary"
      >
        I have this
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-3 w-full space-y-3">
      <input type="hidden" name="alertKey" value={alertKey} />
      <FormError message={state.error} />

      <Field
        label="What is being done about it?"
        htmlFor={`note-${alertKey}`}
        required
        error={state.fieldErrors?.note}
        hint="Everybody sees this, and everybody sees it was you."
      >
        <TextInput
          id={`note-${alertKey}`}
          name="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Feed ordered, arriving Thursday"
          error={state.fieldErrors?.note}
        />
      </Field>

      <Field
        label="Bring it back on"
        htmlFor={`until-${alertKey}`}
        required
        error={state.fieldErrors?.until}
        hint={`If it is still true then, it comes back. ${MAX_PARK_DAYS} days is the longest.`}
      >
        <TextInput
          id={`until-${alertKey}`}
          name="until"
          type="date"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          error={state.fieldErrors?.until}
        />
      </Field>

      <div className="flex items-center gap-2">
        <Submit label="Park it" busy="Parking…" />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-touch rounded-control px-3 text-[13px] font-semibold text-text-secondary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Bring one back.
 *
 * Same shape as parking, and same reason for having no success message: the
 * alert returns to the live list above, which is the outcome and says so better
 * than a sentence would.
 */
export function LiftForm({ parkId }: { parkId: string }) {
  const [state, formAction] = useActionState(liftAlert, {} as AlertFormState);

  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="parkId" value={parkId} />
      <FormError message={state.error} />
      <Submit label="Bring it back" busy="…" />
    </form>
  );
}
