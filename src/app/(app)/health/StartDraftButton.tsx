'use client';

import { useFormStatus } from 'react-dom';
import { startDraft } from './actions';

/**
 * Starting the draft.
 *
 * A PLAIN FORM, NOT A LINK, because it writes. And deliberately understated:
 * this is not a feature anybody should feel clever for using — it produces a
 * list of questions, and the only thing that makes it useful is taking it to
 * somebody who can answer them.
 */
export function StartDraftButton() {
  return (
    <form action={startDraft}>
      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-5 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken disabled:opacity-60"
    >
      {pending ? 'Starting…' : 'Start a draft to take to a vet'}
    </button>
  );
}
