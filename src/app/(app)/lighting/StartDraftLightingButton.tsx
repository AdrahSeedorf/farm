'use client';

import { useFormStatus } from 'react-dom';
import { startDraft } from './actions';

/**
 * A plain form, not a link, because it writes.
 *
 * Understated on purpose. What it produces is a list of numbers to argue with,
 * and the only thing that makes it useful is taking it to somebody who knows
 * the bird.
 */
export function StartDraftLightingButton() {
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
      {pending ? 'Starting…' : 'Start a draft to take to the hatchery'}
    </button>
  );
}
