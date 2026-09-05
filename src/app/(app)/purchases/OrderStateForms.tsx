'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, FormError, Button } from '@/components/ui/form';
import { sendOrder, killOrder, dropLine, type OrderFormState } from './actions';

function Pending({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

/**
 * Mark an order as sent.
 *
 * The wording says what it costs, because it is the one irreversible step on
 * this screen: after this the lines are the record of what the supplier was
 * told, and correcting the order means cancelling and re-placing it.
 */
export function SendOrderForm({ orderId, sent }: { orderId: string; sent: boolean }) {
  const [state, formAction] = useActionState(
    sendOrder.bind(null, orderId),
    {} as OrderFormState,
  );

  // THE SECTION IS RENDERED WHETHER OR NOT THE ORDER IS STILL A DRAFT, and this
  // branch — not the parent — is what hides the button. Hiding the whole
  // section on success unmounts this component, and an unmounted component
  // takes its confirmation message with it: the click appears to do nothing.
  // That has now been the same bug four times in this codebase.
  return (
    <form action={formAction}>
      <input type="hidden" name="intent" value="send" />
      {sent ? null : (
        <>
          <Pending label="Mark as sent" busy="Marking…" />
          <p className="mt-2 max-w-md text-[13px] text-text-secondary">
            Once it is sent, the lines are fixed. Correcting a sent order means cancelling it
            and placing a new one, so both halves stay on the record.
          </p>
        </>
      )}
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

/**
 * The card the cancellation lives in.
 *
 * Declared OUT HERE, not inside the component. A component defined during
 * render is a new component type on every render, so React unmounts and
 * remounts its whole subtree — which in this file would throw away the very
 * confirmation message this arrangement exists to preserve.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
      {children}
    </section>
  );
}

/**
 * Cancel an order.
 *
 * The reason is required, and the button is behind a disclosure so it cannot be
 * hit by accident on a phone. Cancelling is not deleting: the order, its lines
 * and this reason all stay, because goods do sometimes turn up against a
 * cancelled order and the receiving screen has to be able to say so.
 */
export function CancelOrderForm({
  orderId,
  cancelled,
}: {
  orderId: string;
  cancelled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(
    killOrder.bind(null, orderId),
    {} as OrderFormState,
  );

  // THE WHOLE SECTION LIVES IN HERE, including its heading. The parent renders
  // this component for a cancelled order as well as a live one — if the parent
  // hid the section on success, this component would unmount and take its
  // confirmation with it, and the click would appear to have done nothing.
  if (cancelled && !state.ok) return null;

  if (state.ok) {
    return (
      <Frame>
        <p role="status" className="text-[14px] font-medium text-text-primary">
          {state.ok}
        </p>
      </Frame>
    );
  }

  if (!open) {
    return (
      <Frame>
        <h2 className="text-[15px] font-semibold text-text-primary">Not going ahead?</h2>
        <p className="mt-1 max-w-lg text-[14px] text-text-secondary">
          Cancelling keeps the order and its lines exactly as they are, with the reason
          attached. Nothing is deleted.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 inline-flex min-h-touch items-center rounded-control border border-status-critical bg-surface-card px-4 text-[14px] font-semibold text-status-critical hover:bg-status-critical-bg"
        >
          Cancel this order
        </button>
      </Frame>
    );
  }

  return (
    <Frame>
    <form action={formAction} className="space-y-3" noValidate>
      <FormError message={state.error} />
      <Field
        label="Why is it being cancelled?"
        htmlFor="cancelReason"
        required
        error={state.fieldErrors?.cancelReason}
        hint="In three months this is the only explanation there is."
      >
        <TextInput
          id="cancelReason"
          name="cancelReason"
          placeholder="Mill out of stock, ordered from Kumasi instead"
          error={state.fieldErrors?.cancelReason}
        />
      </Field>
      <div className="flex items-center gap-3">
        <Pending label="Cancel the order" busy="Cancelling…" />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex min-h-touch items-center rounded-control px-4 text-[14px] font-semibold text-text-secondary hover:text-text-primary"
        >
          Leave it alone
        </button>
      </div>
    </form>
    </Frame>
  );
}

/** Remove a line from a draft. */
export function RemoveLineButton({
  orderId,
  lineId,
  itemName,
}: {
  orderId: string;
  lineId: string;
  itemName: string;
}) {
  const [state, formAction] = useActionState(
    dropLine.bind(null, orderId, lineId),
    {} as OrderFormState,
  );

  return (
    <form action={formAction} className="text-right">
      <input type="hidden" name="intent" value="remove" />
      <Remove itemName={itemName} />
      {state.error ? (
        <p role="alert" className="mt-1 text-[13px] text-status-critical">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function Remove({ itemName }: { itemName: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[36px] rounded-control px-2.5 text-[13px] font-semibold text-text-secondary transition-colors hover:bg-surface-sunken hover:text-status-critical disabled:opacity-50"
    >
      {pending ? '…' : 'Remove'}
      <span className="sr-only"> {itemName}</span>
    </button>
  );
}
