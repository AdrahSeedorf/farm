'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { formatGHS } from '@/lib/money';
import { lineTotal, roundingDrift, unitCostPerBase } from '@/lib/receiving';
import { receiveStock, type ReceiptFormState } from './actions';

export interface ReceiveItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  unitKey: string;
  unitName: string;
  dimension: string;
  isPerishable: boolean;
}

export interface ReceiveUnit {
  key: string;
  name: string;
  symbol: string;
  dimension: string;
}

export interface ReceiveLocation {
  id: string;
  name: string;
  code: string;
  siteName: string;
}

function Submit({ confirming }: { confirming: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Recording…' : confirming ? 'Yes, record it as entered' : 'Record delivery'}
    </Button>
  );
}

export function ReceiveForm({
  items,
  units,
  locations,
  today,
}: {
  items: ReceiveItem[];
  units: ReceiveUnit[];
  locations: ReceiveLocation[];
  today: string;
}) {
  const [state, formAction] = useActionState(receiveStock, {} as ReceiptFormState);

  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [occurredOn, setOccurredOn] = useState(today);
  const [quantity, setQuantity] = useState('');
  const [unitKey, setUnitKey] = useState(items[0]?.unitKey ?? '');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [priceCedis, setPriceCedis] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const item = items.find((i) => i.id === itemId);
  const e = state.fieldErrors ?? {};
  const confirming = (state.warnings?.length ?? 0) > 0;

  const unitOptions = useMemo(
    () => units.filter((u) => !item || u.dimension === item.dimension),
    [units, item],
  );

  /**
   * React 19 resets the form after a successful action. It restores controlled
   * inputs from state, but a `<select>` whose DOM value was cleared keeps
   * SHOWING the old option while submitting nothing. That bug cost a cause of
   * death on the daily record, so the values are pushed back explicitly here.
   */
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    for (const [name, value] of [
      ['itemId', itemId],
      ['stockLocationId', locationId],
      ['enteredUomKey', unitKey],
    ] as const) {
      const el = form.elements.namedItem(name) as HTMLSelectElement | null;
      if (el && el.value !== value) el.value = value;
    }
  });

  // Clear only what changes between lines of the same delivery note. The store,
  // the date and the item stay, because the next line is usually the same
  // delivery and re-picking them each time is how mistakes get made.
  //
  // Adjusted DURING RENDER rather than in an effect — React's own recommended
  // shape for "reset some state when a prop changes". An effect here would
  // render the just-saved values once before wiping them, which flickers, and
  // would tempt the next reader into a dependency array that clears the form on
  // every keystroke.
  const [clearedFor, setClearedFor] = useState<string | null>(null);
  if (state.saved && state.saved.movementId !== clearedFor) {
    setClearedFor(state.saved.movementId);
    setQuantity('');
    setBatchNumber('');
    setExpiresOn('');
    setPriceCedis('');
    setNotes('');
  }

  function chooseItem(nextId: string) {
    setItemId(nextId);
    const next = items.find((i) => i.id === nextId);
    if (next) setUnitKey(next.unitKey);
    setBatchNumber('');
    setExpiresOn('');
  }

  // Live arithmetic, so a mistyped quantity or price is visible before saving
  // rather than at the month end.
  const preview = (() => {
    const q = Number(quantity);
    const p = Number(priceCedis);
    if (!quantity || !priceCedis || !Number.isFinite(q) || !Number.isFinite(p) || q <= 0) {
      return null;
    }
    try {
      const perBase = unitCostPerBase(p, unitKey);
      const baseUnit = { COUNT: 'piece', MASS: 'kg', VOLUME: 'litre' }[item?.dimension ?? 'COUNT'];
      return {
        total: formatGHS(lineTotal(q, p)),
        perBase: `${formatGHS(perBase)} per ${baseUnit}`,
        drift: roundingDrift(q, p, unitKey),
      };
    } catch {
      return null;
    }
  })();

  if (items.length === 0 || locations.length === 0) {
    return (
      <p className="text-[15px] text-text-secondary">
        {items.length === 0 ? (
          <>
            There are no items to receive yet.{' '}
            <Link href="/inventory/new" className="font-semibold text-brand-primary">
              Add one first
            </Link>
            .
          </>
        ) : (
          <>
            There is no store to receive into.{' '}
            <Link href="/inventory/locations" className="font-semibold text-brand-primary">
              Add a store first
            </Link>
            .
          </>
        )}
      </p>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-5" noValidate>
      <FormError message={state.error} />

      {state.saved ? (
        <p
          role="status"
          className="rounded-control border border-border-strong bg-surface-sunken px-4 py-3 text-[14px] text-text-primary"
        >
          <strong className="font-semibold">{state.saved.itemName}</strong> recorded
          {state.saved.batchNumber ? ` as batch ${state.saved.batchNumber}` : ''}.{' '}
          {formatQuantityRough(state.saved.onHand)} {state.saved.unitKey.replace(/_/g, ' ')} now in
          this store.{' '}
          <Link
            href={`/inventory/${state.saved.itemId}`}
            className="font-semibold text-brand-primary"
          >
            View item
          </Link>
        </p>
      ) : null}

      {confirming ? (
        <div
          role="alert"
          className="rounded-control border border-status-attention bg-status-attention-bg px-4 py-3"
        >
          <p className="text-[14px] font-semibold text-status-attention">
            Check this before recording
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[14px] text-status-attention">
            {state.warnings!.map((w) => (
              <li key={`${w.field}:${w.message}`}>{w.message}</li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-status-attention">
            Nothing has been saved yet. Correct the entry, or record it as it stands.
          </p>
        </div>
      ) : null}
      <input type="hidden" name="acknowledgedToken" value={state.warningToken ?? ''} />

      <Field label="Item" htmlFor="itemId" required error={e.itemId}>
        <Select
          id="itemId"
          name="itemId"
          value={itemId}
          onChange={(ev) => chooseItem(ev.target.value)}
          error={e.itemId}
          required
        >
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.sku})
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="How much arrived" htmlFor="quantity" required error={e.quantity}>
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
            required
          />
        </Field>

        <Field
          label="In"
          htmlFor="enteredUomKey"
          required
          error={e.enteredUomKey}
          hint={item ? `Stored as ${item.unitName.toLowerCase()}.` : undefined}
        >
          <Select
            id="enteredUomKey"
            name="enteredUomKey"
            value={unitKey}
            onChange={(ev) => setUnitKey(ev.target.value)}
            error={e.enteredUomKey}
            required
          >
            {unitOptions.map((u) => (
              <option key={u.key} value={u.key}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Into which store" htmlFor="stockLocationId" required error={e.stockLocationId}>
          <Select
            id="stockLocationId"
            name="stockLocationId"
            value={locationId}
            onChange={(ev) => setLocationId(ev.target.value)}
            error={e.stockLocationId}
            required
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
            required
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Batch or lot number"
          htmlFor="batchNumber"
          error={e.batchNumber}
          hint="From the label. Leave blank and one is stamped from the date."
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
            item?.isPerishable
              ? 'Needed so this is issued before shorter-dated stock.'
              : 'Only if the label carries one.'
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
        label="Price"
        htmlFor="priceCedis"
        error={e.priceCedis}
        hint={`In cedis, per ${unitLabel(unitOptions, unitKey)}. From the invoice.`}
      >
        <TextInput
          id="priceCedis"
          name="priceCedis"
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={priceCedis}
          onChange={(ev) => setPriceCedis(ev.target.value)}
          error={e.priceCedis}
        />
      </Field>

      {preview ? (
        <p className="rounded-control border border-border-default bg-surface-sunken px-3.5 py-2.5 text-[13px] text-text-secondary">
          Invoice line <strong className="font-semibold text-text-primary">{preview.total}</strong>
          {' · '}
          stored as {preview.perBase}
          {preview.drift !== 0 ? (
            <span className="block text-text-muted">
              Rounding to whole pesewas moves the stored value by {formatGHS(preview.drift)}.
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Supplier or waybill"
          htmlFor="reference"
          error={e.reference}
          hint="Free text for now — suppliers get their own records later."
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
          />
        </Field>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Submit confirming={confirming} />
        <Link
          href="/inventory"
          className="inline-flex min-h-touch items-center rounded-control px-4 text-[15px] font-semibold text-text-secondary hover:text-text-primary"
        >
          Done
        </Link>
      </div>
    </form>
  );
}

function unitLabel(units: ReceiveUnit[], key: string): string {
  return units.find((u) => u.key === key)?.name.toLowerCase() ?? 'unit';
}

function formatQuantityRough(value: number): string {
  return new Intl.NumberFormat('en-GH', { maximumFractionDigits: 2 }).format(value);
}
