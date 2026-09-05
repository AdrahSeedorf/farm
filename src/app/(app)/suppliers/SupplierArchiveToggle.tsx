'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { toggleSupplier, type SupplierFormState } from './actions';

/**
 * Archive or restore one supplier.
 *
 * A supplier is never deleted. Orders and deliveries point at this row, and a
 * year of feed invoices has to stay readable after the farm stops using that
 * mill. Archiving takes the name out of the pickers and leaves the history
 * alone.
 */
export function SupplierArchiveToggle({
  supplierId,
  isActive,
}: {
  supplierId: string;
  isActive: boolean;
}) {
  const [state, formAction] = useActionState(
    toggleSupplier.bind(null, supplierId),
    {} as SupplierFormState,
  );

  return (
    <form action={formAction}>
      {/* The intent is stated, not inferred — see toggleSupplier. */}
      <input type="hidden" name="intent" value={isActive ? 'archive' : 'restore'} />
      <Submit label={isActive ? 'Archive supplier' : 'Restore supplier'} />
      {state.error ? (
        <p role="alert" className="mt-2 text-[13px] text-status-critical">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="mt-2 text-[13px] text-text-secondary">
          {state.ok}
        </p>
      ) : null}
    </form>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-4 text-[14px] font-semibold text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary disabled:opacity-60"
    >
      {pending ? '…' : label}
    </button>
  );
}
