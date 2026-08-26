'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { toggleItemActive, type FormState } from './actions';

/**
 * Archive or restore one item.
 *
 * The refusal case — archiving something that still has stock on hand — comes
 * back as a message rather than a thrown error, because it is a normal answer to
 * a reasonable request, not a fault. It is shown next to the button that caused
 * it rather than at the top of the page, where on a long list nobody would
 * connect the two.
 */
export function ArchiveToggle({
  itemId,
  isActive,
  name,
}: {
  itemId: string;
  isActive: boolean;
  name: string;
}) {
  const [state, formAction] = useActionState(
    toggleItemActive.bind(null, itemId),
    {} as FormState,
  );

  return (
    <form action={formAction} className="text-right">
      {/* The intent is stated, not inferred — see toggleItemActive. */}
      <input type="hidden" name="intent" value={isActive ? 'archive' : 'restore'} />
      <Button label={isActive ? 'Archive' : 'Restore'} name={name} />
      {state.error ? (
        <p role="alert" className="mt-1.5 max-w-xs text-[13px] text-status-critical">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function Button({ label, name }: { label: string; name: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[36px] rounded-control px-2.5 text-[13px] font-semibold text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary disabled:opacity-50"
    >
      {pending ? '…' : label}
      <span className="sr-only"> {name}</span>
    </button>
  );
}
