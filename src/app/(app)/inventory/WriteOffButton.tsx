'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { writeOffExpiredBatch, type FormState } from './actions';

/**
 * Write off one expired batch.
 *
 * Sits beside the warning that prompted it rather than on a separate screen. A
 * warning whose fix is three clicks away in another part of the app is a warning
 * that stays on the page for months.
 */
export function WriteOffButton({
  itemId,
  batchId,
  batchNumber,
}: {
  itemId: string;
  batchId: string;
  batchNumber: string;
}) {
  const [state, formAction] = useActionState(
    writeOffExpiredBatch.bind(null, itemId, batchId),
    {} as FormState,
  );

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="intent" value="writeOff" />
      <Submit batchNumber={batchNumber} />
      {state.error ? (
        <span role="alert" className="ml-2 text-[13px] text-status-critical">
          {state.error}
        </span>
      ) : null}
      {state.ok ? (
        <span role="status" className="ml-2 text-[13px] text-text-secondary">
          {state.ok}
        </span>
      ) : null}
    </form>
  );
}

function Submit({ batchNumber }: { batchNumber: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[36px] rounded-control border border-status-critical px-2.5 text-[13px] font-semibold text-status-critical transition-colors hover:bg-status-critical-bg disabled:opacity-50"
    >
      {pending ? 'Writing off…' : `Write off ${batchNumber}`}
    </button>
  );
}
