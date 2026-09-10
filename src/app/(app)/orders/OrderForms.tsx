'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import {
  startOrder,
  addOrderLine,
  dropOrderLine,
  saveDrawnFrom,
  confirm,
  cancel,
  type OrderFormState,
} from './actions';

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

/** Every field is controlled — React 19 resets uncontrolled inputs when an
 *  action returns, and a rejected order used to wipe what somebody typed. */
export function NewOrderForm({
  customers,
  sites,
}: {
  customers: { id: string; name: string; businessName: string | null }[];
  sites: { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState(startOrder, {} as OrderFormState);
  const [customerId, setCustomerId] = useState('');
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [wantedOn, setWantedOn] = useState('');
  const [notes, setNotes] = useState('');
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormError message={state.error} />

      <Field label="Who is it for" htmlFor="customerId" required error={e.customerId}>
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

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="From which farm" htmlFor="siteId" required error={e.siteId}>
          <Select
            id="siteId"
            name="siteId"
            value={siteId}
            onChange={(ev) => setSiteId(ev.target.value)}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="When do they want it"
          htmlFor="wantedOn"
          error={e.wantedOn}
          hint="Leave blank if nobody has said yet."
        >
          <TextInput
            id="wantedOn"
            name="wantedOn"
            type="date"
            value={wantedOn}
            onChange={(ev) => setWantedOn(ev.target.value)}
            error={e.wantedOn}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes" error={e.notes}>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          value={notes}
          onChange={(ev) => setNotes(ev.target.value)}
          placeholder="Collecting Friday morning"
          className="w-full rounded-control border border-border-strong bg-surface-card px-3 py-2.5 text-[16px] text-text-primary outline-none transition-colors focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
        />
      </Field>

      <div className="flex items-center gap-3 pt-1">
        <Submit label="Start the order" busy="Starting…" />
        <Link
          href="/orders"
          className="inline-flex min-h-touch items-center rounded-control px-4 text-[15px] font-semibold text-text-secondary hover:text-text-primary"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

export function AddLineForm({
  orderId,
  products,
}: {
  orderId: string;
  products: { id: string; name: string; packLabel: string; unitsPerPack: number }[];
}) {
  const [state, formAction] = useActionState(
    addOrderLine.bind(null, orderId),
    {} as OrderFormState,
  );
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const e = state.fieldErrors ?? {};

  const chosen = products.find((p) => p.id === productId);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormError message={state.error} />

      <Field label="Product" htmlFor="productId" required error={e.productId}>
        <Select
          id="productId"
          name="productId"
          value={productId}
          onChange={(ev) => setProductId(ev.target.value)}
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={`How many ${chosen ? `${chosen.packLabel}s` : 'packs'}`}
          htmlFor="quantity"
          required
          error={e.quantity}
          hint={
            chosen
              ? `One ${chosen.packLabel} is ${chosen.unitsPerPack}.`
              : 'Whole packs only.'
          }
        >
          <TextInput
            id="quantity"
            name="quantity"
            inputMode="numeric"
            value={quantity}
            onChange={(ev) => setQuantity(ev.target.value)}
            error={e.quantity}
          />
        </Field>

        <Field
          label="Price each"
          htmlFor="price"
          error={e.price}
          hint="Leave blank to use this buyer’s price. Type one to agree something different for this order."
        >
          <TextInput
            id="price"
            name="price"
            inputMode="decimal"
            placeholder="this buyer’s price"
            value={price}
            onChange={(ev) => setPrice(ev.target.value)}
            error={e.price}
          />
        </Field>
      </div>

      <Field label="Note" htmlFor="lineNote" error={e.note}>
        <TextInput
          id="lineNote"
          name="note"
          value={note}
          onChange={(ev) => setNote(ev.target.value)}
          error={e.note}
        />
      </Field>

      <Submit label="Add to the order" busy="Adding…" />
    </form>
  );
}

export function RemoveLineForm({ orderId, lineId }: { orderId: string; lineId: string }) {
  const [state, formAction] = useActionState(
    dropOrderLine.bind(null, orderId, lineId),
    {} as OrderFormState,
  );
  return (
    <form action={formAction} className="inline">
      <FormError message={state.error} />
      <button
        type="submit"
        className="min-h-touch rounded-control px-2 text-[13px] font-semibold text-text-secondary hover:text-status-critical"
      >
        Remove
      </button>
    </form>
  );
}

export function DrawnFromForm({
  orderId,
  flocks,
  current,
}: {
  orderId: string;
  flocks: { id: string; name: string }[];
  current: string | null;
}) {
  const [state, formAction] = useActionState(
    saveDrawnFrom.bind(null, orderId),
    {} as OrderFormState,
  );
  const [flockId, setFlockId] = useState(current ?? '');

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <FormError message={state.error} />
      <Field
        label="Which house does this produce come from?"
        htmlFor={`flock-${orderId}`}
        hint="Only needed while a house is inside a withdrawal period. The software will not guess."
      >
        <Select
          id={`flock-${orderId}`}
          name="flockId"
          value={flockId}
          onChange={(ev) => setFlockId(ev.target.value)}
        >
          <option value="">Not stated</option>
          {flocks.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
      </Field>
      <Submit label="Save" busy="Saving…" />
    </form>
  );
}

/**
 * Confirming.
 *
 * THE ERROR IS THE POINT OF THIS COMPONENT. A refusal on food-safety grounds has
 * to be impossible to miss and has to say when the produce clears, so it is
 * rendered loudly rather than as a field hint.
 */
export function ConfirmForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState(
    confirm.bind(null, orderId),
    {} as OrderFormState,
  );

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? (
        <div
          role="alert"
          className="rounded-control border border-status-critical bg-status-critical-bg px-3.5 py-3"
        >
          <p className="text-[14px] font-semibold text-status-critical">{state.error}</p>
          {state.clearsOn ? (
            <p className="mt-1 text-[13px] text-status-critical">
              Clear from {state.clearsOn}.
            </p>
          ) : null}
        </div>
      ) : null}
      <Submit label="Confirm with the buyer" busy="Confirming…" />
    </form>
  );
}

export function CancelOrderForm({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(
    cancel.bind(null, orderId),
    {} as OrderFormState,
  );
  const [reason, setReason] = useState('');

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-touch rounded-control px-3 text-[13px] font-semibold text-text-secondary hover:text-text-primary"
      >
        Cancel the order
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-3 w-full space-y-3">
      <FormError message={state.error} />
      <Field
        label="Why?"
        htmlFor={`cancel-${orderId}`}
        required
        error={state.fieldErrors?.reason}
        hint="The order stays on the record — this says what happened to it."
      >
        <TextInput
          id={`cancel-${orderId}`}
          name="reason"
          value={reason}
          onChange={(ev) => setReason(ev.target.value)}
          placeholder="Buyer changed their mind"
          error={state.fieldErrors?.reason}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Submit label="Cancel it" busy="…" />
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
