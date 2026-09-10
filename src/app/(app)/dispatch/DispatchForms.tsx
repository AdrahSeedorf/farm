'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { DISPATCH_METHODS, METHOD_LABELS } from '@/lib/dispatch';
import { recordLoad, reverseLoad, type DispatchFormState } from './actions';

/**
 * Recording what went out.
 *
 * THE FORM IS THE ORDER, WITH A BOX BESIDE EACH LINE. A vehicle is loaded with
 * several things at once, and a form that took one product at a time would be
 * filled in once and abandoned. Each box is pre-filled with what is still
 * outstanding, because that is the ordinary case — and every one is editable,
 * because the case worth recording accurately is the other one.
 *
 * A BLANK BOX IS NOT ZERO TYPED, IT IS "none of this went". Most loads carry some
 * of what was ordered and none of the rest.
 *
 * Every field is controlled: React 19 resets uncontrolled inputs when an action
 * returns, and a load rejected by the withdrawal gate used to wipe everything
 * somebody had just typed at the gate.
 */

export interface DispatchableLine {
  id: string;
  productName: string;
  packLabel: string;
  ordered: number;
  dispatched: number;
  outstanding: number;
}

function Submit({ confirming }: { confirming: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending
        ? 'Recording…'
        : confirming
          ? 'Yes, record it as it stands'
          : 'Record what went out'}
    </Button>
  );
}

export function RecordLoadForm({
  orderId,
  lines,
  today,
}: {
  orderId: string;
  lines: DispatchableLine[];
  today: string;
}) {
  const [state, formAction] = useActionState(
    recordLoad.bind(null, orderId),
    {} as DispatchFormState,
  );
  const [method, setMethod] = useState<string>('COLLECTED');
  const [dispatchedOn, setDispatchedOn] = useState(today);
  const [takenBy, setTakenBy] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.outstanding > 0 ? String(l.outstanding) : ''])),
  );
  const e = state.fieldErrors ?? {};
  const confirming = Boolean(state.warnings?.length);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.error ? (
        <div
          role="alert"
          className="rounded-control border border-status-critical bg-status-critical-bg px-3.5 py-3"
        >
          <p className="text-[14px] font-semibold text-status-critical">{state.error}</p>
          {state.clearsOn ? (
            <p className="mt-1 text-[13px] text-status-critical">Clear from {state.clearsOn}.</p>
          ) : null}
        </div>
      ) : null}

      {confirming ? (
        <div
          role="alert"
          className="rounded-control border border-status-attention bg-status-attention-bg px-3.5 py-3"
        >
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-status-attention">
            Check this before the vehicle leaves
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[14px] text-status-attention">
            {state.warnings!.map((w) => (
              <li key={`${w.field}:${w.message}`}>{w.message}</li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-status-attention">
            Nothing has been saved yet. Correct it, or record it exactly as it stands — what
            actually went out is what belongs on the record.
          </p>
        </div>
      ) : null}
      <input type="hidden" name="acknowledged" value={state.warningToken ?? ''} />

      <div className="space-y-3">
        {lines.map((line) => (
          <Field
            key={line.id}
            label={`${line.productName}`}
            htmlFor={`qty-${line.id}`}
            error={e[`qty-${line.id}`]}
            hint={
              line.outstanding > 0
                ? `${line.outstanding} of ${line.ordered} ${line.packLabel}s still to go.`
                : `All ${line.ordered} have already gone. Leave it blank.`
            }
          >
            <TextInput
              id={`qty-${line.id}`}
              name={`qty-${line.id}`}
              inputMode="numeric"
              placeholder="none"
              value={quantities[line.id] ?? ''}
              onChange={(ev) =>
                setQuantities((q) => ({ ...q, [line.id]: ev.target.value }))
              }
              error={e[`qty-${line.id}`]}
            />
          </Field>
        ))}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="How did it leave" htmlFor="method" required error={e.method}>
          <Select
            id="method"
            name="method"
            value={method}
            onChange={(ev) => setMethod(ev.target.value)}
            error={e.method}
          >
            {DISPATCH_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="What day" htmlFor="dispatchedOn" required error={e.dispatchedOn}>
          <TextInput
            id="dispatchedOn"
            name="dispatchedOn"
            type="date"
            value={dispatchedOn}
            onChange={(ev) => setDispatchedOn(ev.target.value)}
            error={e.dispatchedOn}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Who took it"
          htmlFor="takenBy"
          error={e.takenBy}
          hint="The driver, or the buyer if they collected it."
        >
          <TextInput
            id="takenBy"
            name="takenBy"
            value={takenBy}
            onChange={(ev) => setTakenBy(ev.target.value)}
            error={e.takenBy}
          />
        </Field>

        <Field label="Vehicle" htmlFor="vehicle" error={e.vehicle} hint="GT 4321-22, or a description.">
          <TextInput
            id="vehicle"
            name="vehicle"
            value={vehicle}
            onChange={(ev) => setVehicle(ev.target.value)}
            error={e.vehicle}
          />
        </Field>
      </div>

      <Field
        label="Who received it"
        htmlFor="receivedBy"
        error={e.receivedBy}
        hint="On a delivery this is the only record that it arrived."
      >
        <TextInput
          id="receivedBy"
          name="receivedBy"
          value={receivedBy}
          onChange={(ev) => setReceivedBy(ev.target.value)}
          error={e.receivedBy}
        />
      </Field>

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

/**
 * Reversing a load.
 *
 * Closed until asked for, because it is not something anybody should do quickly.
 */
export function ReverseLoadForm({ dispatchId }: { dispatchId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(
    reverseLoad.bind(null, dispatchId),
    {} as DispatchFormState,
  );
  const [reason, setReason] = useState('');

  if (state.ok) {
    return (
      <p role="status" className="text-[14px] font-medium text-brand-primary">
        {state.ok}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-touch rounded-control px-3 text-[13px] font-semibold text-text-secondary hover:text-text-primary"
      >
        Reverse this load
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-3 w-full space-y-3">
      <FormError message={state.error} />
      <Field
        label="Why?"
        htmlFor={`reverse-${dispatchId}`}
        required
        error={state.fieldErrors?.reason}
        hint="The load stays on the record and the stock goes back. This says what happened."
      >
        <TextInput
          id={`reverse-${dispatchId}`}
          name="reason"
          value={reason}
          onChange={(ev) => setReason(ev.target.value)}
          placeholder="Loaded onto the wrong vehicle"
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
      {pending ? 'Reversing…' : 'Put it back'}
    </Button>
  );
}
