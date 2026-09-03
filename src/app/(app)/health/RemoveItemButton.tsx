'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { removeProgrammeItem, type HealthFormState } from './actions';

/**
 * Remove one planned entry.
 *
 * Refuses when something was actually given against it — that row has stopped
 * being a plan and become history, and deleting it would orphan the record of a
 * vaccination that really happened.
 */
export function RemoveItemButton({
  programmeId,
  itemId,
  name,
}: {
  programmeId: string;
  itemId: string;
  name: string;
}) {
  const [state, formAction] = useActionState(
    removeProgrammeItem.bind(null, programmeId, itemId),
    {} as HealthFormState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="intent" value="remove" />
      <Submit name={name} />
      {state.error ? (
        <p role="alert" className="mt-1 max-w-xs text-right text-[12px] text-status-critical">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function Submit({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[36px] rounded-control px-2 text-[13px] font-semibold text-text-secondary transition-colors hover:bg-surface-sunken hover:text-status-critical disabled:opacity-50"
    >
      {pending ? '…' : 'Remove'}
      <span className="sr-only"> {name}</span>
    </button>
  );
}
