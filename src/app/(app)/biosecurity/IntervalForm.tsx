'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { updateCleaningInterval, type BiosecurityFormState } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-3 text-[13px] font-semibold text-text-primary transition-colors hover:bg-surface-sunken disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Set'}
    </button>
  );
}

/** How often a house should be cleaned. Blank means nobody is measuring it. */
export function IntervalForm({
  productionUnitId,
  current,
}: {
  productionUnitId: string;
  current: number | null;
}) {
  const [state, formAction] = useActionState(
    updateCleaningInterval.bind(null, productionUnitId),
    {} as BiosecurityFormState,
  );
  const [days, setDays] = useState(current === null ? '' : String(current));

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <label htmlFor={`interval-${productionUnitId}`} className="text-[13px] text-text-secondary">
        Clean every
      </label>
      <input
        id={`interval-${productionUnitId}`}
        name="cleaningIntervalDays"
        type="number"
        inputMode="numeric"
        min="1"
        max="365"
        placeholder="—"
        value={days}
        onChange={(ev) => setDays(ev.target.value)}
        className="min-h-touch w-20 rounded-control border border-border-strong bg-surface-card px-2.5 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
      />
      <span className="text-[13px] text-text-secondary">days</span>
      <Submit />
      {state.fieldErrors?.cleaningIntervalDays ? (
        <span className="w-full text-[12px] text-status-critical">
          {state.fieldErrors.cleaningIntervalDays}
        </span>
      ) : null}
      {state.ok ? (
        <span role="status" className="w-full text-[12px] text-text-secondary">
          {state.ok}
        </span>
      ) : null}
    </form>
  );
}
