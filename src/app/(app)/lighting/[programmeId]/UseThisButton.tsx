'use client';

import { useFormStatus } from 'react-dom';
import { useThisProgramme } from '../actions';

/** Make this the programme the houses follow. */
export function UseThisButton({ programmeId }: { programmeId: string }) {
  return (
    <form action={useThisProgramme.bind(null, programmeId)}>
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
      {pending ? 'Switching…' : 'Use this programme'}
    </button>
  );
}
