'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { correctRecord } from './actions';
import type { CollectionFormState } from './actions';

/**
 * Correct one collection.
 *
 * A REVERSAL, NEVER AN EDIT. The original row stays exactly as it was reported
 * and a second row carrying the negative of it is added beside it. The day's
 * figure comes out right and the mistake stays visible — which is precisely
 * what makes the corrected figure believable six months later.
 *
 * The reason is required. A correction with no reason is unreadable by the time
 * anybody needs to read it.
 */
export function CorrectionForm({
  recordId,
  sequence,
}: {
  recordId: string;
  sequence: number;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [state, formAction] = useActionState(
    correctRecord.bind(null, recordId),
    {} as CollectionFormState,
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[36px] rounded-control px-2.5 text-[13px] font-semibold text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary"
      >
        Correct
        <span className="sr-only"> collection {sequence}</span>
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-2 w-full space-y-2" noValidate>
      <label
        htmlFor={`reason-${recordId}`}
        className="block text-[13px] font-semibold text-text-primary"
      >
        What was wrong with collection {sequence}?
      </label>
      <input
        id={`reason-${recordId}`}
        name="reason"
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Counted the second house by mistake"
        className="min-h-touch w-full rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
      />
      {state.fieldErrors?.reason ? (
        <p className="text-[13px] text-status-critical">{state.fieldErrors.reason}</p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-[13px] text-status-critical">
          {state.error}
        </p>
      ) : null}
      {/*
        What happened in the store, said out loud. Usually "put back as it was";
        occasionally the store could not comply — the produce has already been
        sold — and then this is the only place anybody learns that the two
        ledgers need reconciling by hand.
      */}
      {state.saved?.stock ? (
        <p
          role="status"
          className={`text-[13px] ${
            /could not/i.test(state.saved.stock)
              ? 'font-medium text-status-attention'
              : 'text-text-secondary'
          }`}
        >
          Correction recorded. {state.saved.stock}
        </p>
      ) : null}
      <p className="text-[13px] text-text-muted">
        This adds a reversing entry. The original stays where it is, and both remain on the
        record.
      </p>
      <div className="flex gap-2">
        <Submit />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-touch rounded-control border border-border-strong bg-surface-card px-4 text-[14px] font-semibold text-text-primary hover:bg-surface-sunken"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-touch rounded-control border border-status-critical bg-surface-card px-4 text-[14px] font-semibold text-status-critical transition-colors hover:bg-status-critical-bg disabled:opacity-60"
    >
      {pending ? 'Recording…' : 'Record the correction'}
    </button>
  );
}
