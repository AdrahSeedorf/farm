'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { setProduceStore } from '../actions';
import type { FormState } from '../../sites/actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-3 text-[13px] font-semibold text-text-primary transition-colors hover:bg-surface-sunken disabled:opacity-60"
    >
      {pending ? 'Saving…' : label}
    </button>
  );
}

/**
 * Make this store the one a farm's produce goes into, or stop it being that.
 *
 * THE INTENT IS AN EXPLICIT FIELD, not inferred from the current state. A
 * flip-flop button on a slow connection gets tapped twice, and a button that
 * reads its own state from the last render would then set and immediately unset
 * — leaving a farm with no produce store and nobody any the wiser. Saying
 * "receive" or "stop" out loud makes the second tap idempotent.
 */
export function ProduceStoreButton({
  locationId,
  receivesProduction,
}: {
  locationId: string;
  receivesProduction: boolean;
}) {
  const [state, formAction] = useActionState(
    setProduceStore.bind(null, locationId),
    {} as FormState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="intent" value={receivesProduction ? 'stop' : 'receive'} />
      <Submit label={receivesProduction ? 'Stop receiving produce' : 'Receive produce here'} />
      {state.error ? (
        <p role="alert" className="mt-1 text-[12px] text-status-critical">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
