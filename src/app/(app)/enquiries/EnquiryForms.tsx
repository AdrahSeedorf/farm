'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, FormError, Button } from '@/components/ui/form';
import { readEnquiry, answerEnquiry, putAsideEnquiry, type EnquiryActionState } from './actions';

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

/**
 * NO SUCCESS MESSAGES IN THIS FILE, and it is the same reason as the alert
 * forms: every one of these actions moves the row it lives in — reading it
 * changes its state, answering it re-sorts it, putting it aside greys it out —
 * so a component that returned a confirmation would be unmounted before the
 * confirmation could render. The outcome is the row visibly changing, which
 * says more than a sentence about the row would.
 *
 * Errors still render, because a rejected action leaves the row exactly where
 * it was and the person needs to know why.
 */
export function ReadForm({ enquiryId }: { enquiryId: string }) {
  const [state, formAction] = useActionState(
    readEnquiry.bind(null, enquiryId),
    {} as EnquiryActionState,
  );

  return (
    <form action={formAction} className="inline">
      <FormError message={state.error} />
      <button
        type="submit"
        className="min-h-touch rounded-control border border-border-strong bg-surface-card px-3 text-[13px] font-semibold text-text-primary hover:bg-surface-sunken"
      >
        I have read this
      </button>
    </form>
  );
}

export function AnswerForm({ enquiryId }: { enquiryId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(
    answerEnquiry.bind(null, enquiryId),
    {} as EnquiryActionState,
  );
  const [note, setNote] = useState('');

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-touch rounded-control bg-brand-primary px-4 text-[13px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
      >
        I have answered them
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-2 w-full space-y-3">
      <FormError message={state.error} />
      <Field
        label="What did you tell them?"
        htmlFor={`note-${enquiryId}`}
        required
        error={state.fieldErrors?.note}
        hint="The price especially. When they ring back in March, this is the only record of it."
      >
        <TextInput
          id={`note-${enquiryId}`}
          name="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Quoted GHS 45 a crate, collection Fridays from March"
          error={state.fieldErrors?.note}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Submit label="Save" busy="Saving…" />
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

export function PutAsideForm({ enquiryId }: { enquiryId: string }) {
  const [state, formAction] = useActionState(
    putAsideEnquiry.bind(null, enquiryId),
    {} as EnquiryActionState,
  );

  return (
    <form action={formAction} className="inline">
      <FormError message={state.error} />
      <button
        type="submit"
        className="min-h-touch rounded-control px-3 text-[13px] font-semibold text-text-secondary hover:text-text-primary"
      >
        Put aside
      </button>
    </form>
  );
}
