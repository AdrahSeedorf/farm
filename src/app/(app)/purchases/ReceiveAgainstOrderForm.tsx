'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { formatGHS, pesewas, toCedis } from '@/lib/money';
import { receiveDelivery, type ReceiveFormState } from './actions';

/**
 * Recording what actually turned up.
 *
 * THE QUANTITY IS IN THE UNIT THE LINE WAS ORDERED IN. Not the item's counting
 * unit, not kilograms — bags, if bags is what was ordered. The two are shown
 * side by side in the hint precisely because they are usually different, and
 * the whole point of failure in this area is somebody entering a number in one
 * and the system reading it as the other.
 *
 * The quantity and price are PRE-FILLED with what is outstanding and what was
 * agreed, because that is the common case — and both are editable, because the
 * uncommon case is the one worth recording accurately.
 */

export interface ReceivableLineView {
  id: string;
  itemName: string;
  itemUnitKey: string;
  quantityOrdered: number;
  unitKey: string;
  quantityReceived: number;
  outstanding: number;
  unitPricePesewas: number | null;
  isPerishable: boolean;
  suggestedBatchNumber: string;
}

interface Props {
  orderId: string;
  orderNumber: string;
  lines: ReceivableLineView[];
  locations: { id: string; name: string; siteName: string }[];
  today: string;
}

function Submit({ confirming }: { confirming: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending
        ? 'Recording…'
        : confirming
          ? 'Yes, record it as entered'
          : 'Record what arrived'}
    </Button>
  );
}

export function ReceiveAgainstOrderForm({
  orderId,
  orderNumber,
  lines,
  locations,
  today,
}: Props) {
  const [state, formAction] = useActionState(
    receiveDelivery.bind(null, orderId),
    {} as ReceiveFormState,
  );

  const firstOutstanding = lines.find((l) => l.outstanding > 0) ?? lines[0];
  const [lineId, setLineId] = useState(firstOutstanding?.id ?? '');
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [occurredOn, setOccurredOn] = useState(today);
  const [quantity, setQuantity] = useState(
    firstOutstanding ? String(firstOutstanding.outstanding || '') : '',
  );
  const [priceCedis, setPriceCedis] = useState(
    firstOutstanding?.unitPricePesewas != null
      ? String(toCedis(pesewas(firstOutstanding.unitPricePesewas)))
      : '',
  );
  const [batchNumber, setBatchNumber] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const line = lines.find((l) => l.id === lineId) ?? null;
  const e = state.fieldErrors ?? {};
  const confirming = (state.warnings?.length ?? 0) > 0;

  // Cleared exactly once per save, DURING RENDER rather than in an effect —
  // React's own shape for "reset some state when something changes". An effect
  // would paint the just-saved values once before wiping them.
  const [clearedFor, setClearedFor] = useState<string | null>(null);
  if (state.saved && state.saved.movementId !== clearedFor) {
    setClearedFor(state.saved.movementId);
    setQuantity('');
    setBatchNumber('');
    setExpiresOn('');
    setNotes('');
  }

  function chooseLine(nextId: string) {
    setLineId(nextId);
    const next = lines.find((l) => l.id === nextId);
    setQuantity(next ? String(next.outstanding || '') : '');
    setPriceCedis(
      next?.unitPricePesewas != null
        ? String(toCedis(pesewas(next.unitPricePesewas)))
        : '',
    );
    setBatchNumber('');
    setExpiresOn('');
  }

  if (lines.length === 0) {
    return (
      <p className="text-[15px] text-text-secondary">
        There is nothing on this order to receive.
      </p>
    );
  }

  if (locations.length === 0) {
    return (
      <p className="text-[15px] text-text-secondary">
        There is no store at this farm to receive into. Set one up before recording the
        delivery — stock has to land somewhere real.
      </p>
    );
  }

  // Live arithmetic, so a mistyped figure shows before it is saved rather than
  // at the month end.
  const q = Number(quantity);
  const p = Number(priceCedis);
  const invoiceTotal =
    quantity && priceCedis && Number.isFinite(q) && Number.isFinite(p) && q > 0
      ? formatGHS(pesewas(Math.round(q * p * 100)))
      : null;

  const agreed = line?.unitPricePesewas ?? null;
  const priceMoved =
    agreed !== null && Number.isFinite(p) && priceCedis !== ''
      ? Math.round(p * 100) - agreed
      : null;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormError message={state.error} />

      {state.saved ? (
        <p
          role="status"
          className="rounded-control border border-border-strong bg-surface-sunken px-4 py-3 text-[14px] text-text-primary"
        >
          <strong className="font-semibold">
            {state.saved.quantity} {state.saved.unitKey.replace(/_/g, ' ')}{' '}
            {state.saved.itemName}
          </strong>{' '}
          recorded{state.saved.batchNumber ? ` as batch ${state.saved.batchNumber}` : ''}.{' '}
          {state.saved.stillOutstanding > 0
            ? `${state.saved.stillOutstanding} ${state.saved.unitKey.replace(/_/g, ' ')} still to come on that line.`
            : 'That line is now covered.'}{' '}
          {state.saved.orderComplete ? 'Everything on this order has now arrived.' : ''}
        </p>
      ) : null}

      {confirming ? (
        <div
          role="alert"
          className="rounded-control border border-status-attention bg-status-attention-bg px-4 py-3"
        >
          <p className="text-[14px] font-semibold text-status-attention">
            Check this before signing the delivery note
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[14px] text-status-attention">
            {state.warnings!.map((w) => (
              <li key={`${w.field}:${w.message}`}>{w.message}</li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-status-attention">
            Nothing has been saved yet. Correct the entry, or record it exactly as it stands
            — what actually arrived is what belongs on the record.
          </p>
        </div>
      ) : null}
      <input type="hidden" name="acknowledgedToken" value={state.warningToken ?? ''} />

      <Field label="What arrived" htmlFor="lineId" required error={e.lineId}>
        <Select
          id="lineId"
          name="lineId"
          value={lineId}
          onChange={(ev) => chooseLine(ev.target.value)}
          error={e.lineId}
        >
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.itemName} — {l.outstanding > 0 ? `${l.outstanding} still to come` : 'covered'}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="How much arrived"
          htmlFor="quantity"
          required
          error={e.quantity}
          hint={
            line
              ? `In ${line.unitKey.replace(/_/g, ' ')}, the unit it was ordered in. ` +
                `${line.quantityOrdered} ordered, ${line.quantityReceived} received so far.`
              : undefined
          }
        >
          <TextInput
            id="quantity"
            name="quantity"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={quantity}
            onChange={(ev) => setQuantity(ev.target.value)}
            error={e.quantity}
          />
        </Field>

        <Field
          label="Invoiced price"
          htmlFor="priceCedis"
          error={e.priceCedis}
          hint={
            line
              ? `Cedis per ${line.unitKey.replace(/_/g, ' ')}, ${
                  agreed === null
                    ? 'as invoiced — no price was agreed on the order.'
                    : `as invoiced. ${formatGHS(pesewas(agreed))} was agreed.`
                }`
              : undefined
          }
        >
          <TextInput
            id="priceCedis"
            name="priceCedis"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={priceCedis}
            onChange={(ev) => setPriceCedis(ev.target.value)}
            error={e.priceCedis}
          />
        </Field>
      </div>

      {priceMoved !== null && priceMoved !== 0 ? (
        <p className="text-[13px] text-text-secondary">
          {formatGHS(pesewas(Math.abs(priceMoved)))} {priceMoved > 0 ? 'dearer' : 'cheaper'}{' '}
          per {line!.unitKey.replace(/_/g, ' ')} than agreed. The invoiced price is what
          enters stock — the order keeps saying what was agreed.
        </p>
      ) : null}

      {invoiceTotal ? (
        <p className="tabular text-[14px] font-semibold text-text-primary">
          This delivery: {invoiceTotal}
        </p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Into which store"
          htmlFor="stockLocationId"
          required
          error={e.stockLocationId}
        >
          <Select
            id="stockLocationId"
            name="stockLocationId"
            value={locationId}
            onChange={(ev) => setLocationId(ev.target.value)}
            error={e.stockLocationId}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} · {l.siteName}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Delivered on" htmlFor="occurredOn" required error={e.occurredOn}>
          <TextInput
            id="occurredOn"
            name="occurredOn"
            type="date"
            max={today}
            value={occurredOn}
            onChange={(ev) => setOccurredOn(ev.target.value)}
            error={e.occurredOn}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Batch or lot number"
          htmlFor="batchNumber"
          error={e.batchNumber}
          hint={
            line
              ? `From the label. Leave blank and ${line.suggestedBatchNumber} is used.`
              : undefined
          }
        >
          <TextInput
            id="batchNumber"
            name="batchNumber"
            value={batchNumber}
            onChange={(ev) => setBatchNumber(ev.target.value)}
            error={e.batchNumber}
          />
        </Field>

        <Field
          label="Expires on"
          htmlFor="expiresOn"
          error={e.expiresOn}
          hint={
            line?.isPerishable
              ? 'This item was set up as expiring. Without a date it cannot be issued shortest-dated first.'
              : undefined
          }
        >
          <TextInput
            id="expiresOn"
            name="expiresOn"
            type="date"
            value={expiresOn}
            onChange={(ev) => setExpiresOn(ev.target.value)}
            error={e.expiresOn}
          />
        </Field>
      </div>

      <Field
        label="Waybill or invoice number"
        htmlFor="reference"
        error={e.reference}
        hint={`Stored alongside ${orderNumber}, so either one finds the delivery.`}
      >
        <TextInput
          id="reference"
          name="reference"
          value={reference}
          onChange={(ev) => setReference(ev.target.value)}
          error={e.reference}
        />
      </Field>

      <Field label="Notes" htmlFor="notes" error={e.notes}>
        <TextInput
          id="notes"
          name="notes"
          value={notes}
          onChange={(ev) => setNotes(ev.target.value)}
          error={e.notes}
          placeholder="Two bags torn, driver noted it"
        />
      </Field>

      <Submit confirming={confirming} />
    </form>
  );
}
