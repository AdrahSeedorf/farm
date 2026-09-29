'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { PAYMENT_METHODS, METHOD_LABELS, METHOD_HINTS, wantsReference, type PaymentMethod } from '@/lib/payments';
import { receivePayment, undoPayment, type PaymentFormState } from './actions';

/**
 * Taking money.
 *
 * Every field is controlled — React 19 resets uncontrolled inputs when an action
 * returns, and this form is explicitly submitted twice whenever a warning comes
 * back, which is exactly where that bug bites hardest.
 *
 * THE REFERENCE FIELD CHANGES WITH THE METHOD. Cash has no transaction ID and
 * asking for one trains people to type nonsense; MoMo has one and it is the only
 * thing that will let this row be matched against the statement later.
 */

function Submit({ confirming }: { confirming: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Recording…' : confirming ? 'Yes, record it as it stands' : 'Record the payment'}
    </Button>
  );
}

export function ReceivePaymentForm({
  customers,
  today,
  fixedCustomerId,
}: {
  customers: { id: string; name: string; businessName: string | null }[];
  today: string;
  /** Set on a buyer's own page, where there is nothing to choose. */
  fixedCustomerId?: string;
}) {
  const [state, formAction] = useActionState(receivePayment, {} as PaymentFormState);
  const [customerId, setCustomerId] = useState(fixedCustomerId ?? '');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('MOMO');
  const [receivedOn, setReceivedOn] = useState(today);
  const [receivedBy, setReceivedBy] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [notes, setNotes] = useState('');
  const e = state.fieldErrors ?? {};
  const confirming = Boolean(state.warnings?.length);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormError message={state.error} />

      {state.ok ? (
        <p
          role="status"
          className="rounded-control border border-brand-primary bg-brand-primary-soft px-3.5 py-3 text-[14px] font-medium text-brand-primary"
        >
          {state.ok}
        </p>
      ) : null}

      {confirming ? (
        <div
          role="alert"
          className="rounded-control border border-status-attention bg-status-attention-bg px-3.5 py-3"
        >
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-status-attention">
            Check this before writing a receipt
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[14px] text-status-attention">
            {state.warnings!.map((w) => (
              <li key={`${w.field}:${w.message}`}>{w.message}</li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-status-attention">
            Nothing has been saved yet. Correct it, or record it exactly as it stands — what
            actually arrived is what belongs on the record.
          </p>
        </div>
      ) : null}
      <input type="hidden" name="acknowledged" value={state.warningToken ?? ''} />

      {fixedCustomerId ? (
        <input type="hidden" name="customerId" value={fixedCustomerId} />
      ) : (
        <Field label="Who paid" htmlFor="customerId" required error={e.customerId}>
          <Select
            id="customerId"
            name="customerId"
            value={customerId}
            onChange={(ev) => setCustomerId(ev.target.value)}
            error={e.customerId}
          >
            <option value="">Choose a buyer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.businessName ? `${c.businessName} · ${c.name}` : c.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="How much" htmlFor="amount" required error={e.amount}>
          <TextInput
            id="amount"
            name="amount"
            inputMode="decimal"
            placeholder="500"
            value={amount}
            onChange={(ev) => setAmount(ev.target.value)}
            error={e.amount}
          />
        </Field>

        <Field label="What day" htmlFor="receivedOn" required error={e.receivedOn}>
          <TextInput
            id="receivedOn"
            name="receivedOn"
            type="date"
            value={receivedOn}
            onChange={(ev) => setReceivedOn(ev.target.value)}
            error={e.receivedOn}
          />
        </Field>
      </div>

      <Field
        label="How it arrived"
        htmlFor="method"
        required
        error={e.method}
        hint={METHOD_HINTS[method]}
      >
        <Select
          id="method"
          name="method"
          value={method}
          onChange={(ev) => setMethod(ev.target.value as PaymentMethod)}
          error={e.method}
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABELS[m]}
            </option>
          ))}
        </Select>
      </Field>

      {/* ASKED FOR ONLY WHERE ONE EXISTS. Cash has no transaction ID, and a
          field that must be filled with something will be filled with anything. */}
      {wantsReference(method) ? (
        <Field
          label="Reference"
          htmlFor="externalRef"
          error={e.externalRef}
          hint="The transaction ID from the alert, or the bank reference."
        >
          <TextInput
            id="externalRef"
            name="externalRef"
            value={externalRef}
            onChange={(ev) => setExternalRef(ev.target.value)}
            error={e.externalRef}
          />
        </Field>
      ) : (
        <Field
          label="Who took it"
          htmlFor="receivedBy"
          error={e.receivedBy}
          hint="On cash this is the only record the payment leaves."
        >
          <TextInput
            id="receivedBy"
            name="receivedBy"
            value={receivedBy}
            onChange={(ev) => setReceivedBy(ev.target.value)}
            error={e.receivedBy}
          />
        </Field>
      )}

      <Field label="Notes" htmlFor="notes" error={e.notes}>
        <TextInput
          id="notes"
          name="notes"
          value={notes}
          onChange={(ev) => setNotes(ev.target.value)}
          error={e.notes}
        />
      </Field>

      <Submit confirming={confirming} />
    </form>
  );
}

/** Taking a payment back off the books. Closed until asked for. */
export function ReversePaymentForm({ paymentId }: { paymentId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(
    undoPayment.bind(null, paymentId),
    {} as PaymentFormState,
  );
  const [reason, setReason] = useState('');

  if (state.ok) {
    return (
      <p role="status" className="text-[13.5px] font-medium text-brand-primary">
        {state.ok}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-touch rounded-control px-2 text-[13px] font-semibold text-text-secondary hover:text-text-primary"
      >
        Reverse
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-3 w-full space-y-3">
      <FormError message={state.error} />
      <Field
        label="Why?"
        htmlFor={`reverse-${paymentId}`}
        required
        error={state.fieldErrors?.reason}
        hint="The payment stays on the record and the balance goes back up. This says what happened."
      >
        <TextInput
          id={`reverse-${paymentId}`}
          name="reason"
          value={reason}
          onChange={(ev) => setReason(ev.target.value)}
          placeholder="Entered twice"
          error={state.fieldErrors?.reason}
        />
      </Field>
      <div className="flex items-center gap-2">
        <ReverseSubmit />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-touch rounded-control px-3 text-[13px] font-semibold text-text-secondary"
        >
          Leave it
        </button>
      </div>
    </form>
  );
}

function ReverseSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Reversing…' : 'Take it off'}
    </Button>
  );
}
