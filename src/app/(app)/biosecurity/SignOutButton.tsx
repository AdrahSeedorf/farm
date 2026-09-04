'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { signOut, type BiosecurityFormState } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-3 text-[13px] font-semibold text-text-primary transition-colors hover:bg-surface-sunken disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Sign out'}
    </button>
  );
}

/**
 * Sign a visitor off the site.
 *
 * The time is prefilled with now and editable, because somebody remembering at
 * five o'clock that the feed lorry left at two should be able to say so — and
 * a log that can only record the moment the button was pressed slowly fills up
 * with departure times that are all wrong in the same direction.
 */
export function SignOutButton({
  visitId,
  nowLocal,
}: {
  visitId: string;
  nowLocal: string;
}) {
  const [state, formAction] = useActionState(
    signOut.bind(null, visitId),
    {} as BiosecurityFormState,
  );
  const [departedAt, setDepartedAt] = useState(nowLocal);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <label htmlFor={`out-${visitId}`} className="sr-only">
        Time they left
      </label>
      <input
        id={`out-${visitId}`}
        name="departedAt"
        type="datetime-local"
        value={departedAt}
        onChange={(ev) => setDepartedAt(ev.target.value)}
        className="min-h-touch rounded-control border border-border-strong bg-surface-card px-2.5 text-[14px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
      />
      <Submit />
      {state.error ? (
        <span role="alert" className="text-[12px] text-status-critical">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
