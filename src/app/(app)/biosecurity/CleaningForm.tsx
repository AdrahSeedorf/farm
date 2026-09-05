'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import {
  CLEANING_SCOPES,
  SCOPE_LABELS,
  CLEANING_STAGES,
  STAGE_LABELS,
  STAGES_THAT_RESET_THE_CLOCK,
  type CleaningStage,
} from '@/lib/validation/biosecurity';
import { logCleaning, type CleaningFormState } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Record it'}
    </Button>
  );
}

export interface CleaningFormOptions {
  sites: { id: string; name: string }[];
  units: { id: string; name: string; siteId: string }[];
  products: { id: string; name: string; sku: string; unitKey: string }[];
  stores: { id: string; name: string; siteId: string }[];
}

/**
 * Record a clean.
 *
 * THE FORM STAYS PUT AND KEEPS THE FARM, THE DATE AND THE PRODUCT. Cleaning
 * comes in runs — three stages on one house across a week, or four houses in a
 * morning — and the fields that change between entries are the place and the
 * stage. Clearing everything after each save would mean re-entering the same
 * disinfectant and dilution four times, which is how dilutions end up wrong.
 */
export function CleaningForm({
  options,
  today,
}: {
  options: CleaningFormOptions;
  today: string;
}) {
  const [state, formAction] = useActionState(logCleaning, {} as CleaningFormState);
  const e = state.fieldErrors ?? {};

  const [siteId, setSiteId] = useState(options.sites[0]?.id ?? '');
  const [scope, setScope] = useState<string>('PRODUCTION_UNIT');
  const [unitId, setUnitId] = useState('');
  const [areaName, setAreaName] = useState('');
  const [stage, setStage] = useState<string>('DISINFECT');
  const [performedOn, setPerformedOn] = useState(today);
  const [performedBy, setPerformedBy] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [storeId, setStoreId] = useState('');
  const [dilution, setDilution] = useState('');
  const [contact, setContact] = useState('');
  const [notes, setNotes] = useState('');

  const units = options.units.filter((u) => u.siteId === siteId);
  const stores = options.stores.filter((s) => s.siteId === siteId);
  const product = options.products.find((p) => p.id === itemId) ?? null;

  const resetsClock = STAGES_THAT_RESET_THE_CLOCK.includes(stage as CleaningStage);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <FormError message={state.error} />

      {state.ok ? (
        <div
          role="status"
          className="rounded-control border border-border-strong bg-surface-sunken px-4 py-3"
        >
          <p className="text-[15px] font-medium text-text-primary">{state.ok}</p>
          {state.stockNote ? (
            <p
              className={`mt-1 text-[13px] ${
                /could not|short of/i.test(state.stockNote)
                  ? 'font-medium text-status-attention'
                  : 'text-text-secondary'
              }`}
            >
              {state.stockNote}
            </p>
          ) : null}
        </div>
      ) : null}

      {options.sites.length > 1 ? (
        <Field label="Farm" htmlFor="siteId" required error={e.siteId}>
          <Select
            id="siteId"
            name="siteId"
            value={siteId}
            onChange={(ev) => {
              setSiteId(ev.target.value);
              setUnitId('');
              setStoreId('');
            }}
            error={e.siteId}
          >
            {options.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="siteId" value={siteId} />
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="What was cleaned" htmlFor="scope" required error={e.scope}>
          <Select
            id="scope"
            name="scope"
            value={scope}
            onChange={(ev) => setScope(ev.target.value)}
            error={e.scope}
          >
            {CLEANING_SCOPES.map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>

        {scope === 'PRODUCTION_UNIT' ? (
          <Field label="Which house" htmlFor="productionUnitId" required error={e.productionUnitId}>
            <Select
              id="productionUnitId"
              name="productionUnitId"
              value={unitId}
              onChange={(ev) => setUnitId(ev.target.value)}
              error={e.productionUnitId}
            >
              <option value="">Choose…</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field
            label="What exactly"
            htmlFor="areaName"
            required
            error={e.areaName}
            hint="Footbath at the gate, the egg trolley, KX-1234-22."
          >
            <TextInput
              id="areaName"
              name="areaName"
              value={areaName}
              onChange={(ev) => setAreaName(ev.target.value)}
              error={e.areaName}
            />
          </Field>
        )}
      </div>
      {scope === 'PRODUCTION_UNIT' ? (
        <input type="hidden" name="areaName" value="" />
      ) : (
        <input type="hidden" name="productionUnitId" value="" />
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Which part of the job"
          htmlFor="stage"
          required
          error={e.stage}
          hint="One row per stage. Muck-out, wash and disinfect happen on different days."
        >
          <Select
            id="stage"
            name="stage"
            value={stage}
            onChange={(ev) => setStage(ev.target.value)}
            error={e.stage}
          >
            {CLEANING_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Done on" htmlFor="performedOn" required error={e.performedOn}>
          <TextInput
            id="performedOn"
            name="performedOn"
            type="date"
            max={today}
            value={performedOn}
            onChange={(ev) => setPerformedOn(ev.target.value)}
            error={e.performedOn}
            required
          />
        </Field>
      </div>

      {/*
        Said before saving, because somebody recording a rest period expecting
        it to clear an overdue flag needs to know here, not on the next screen.
      */}
      {scope === 'PRODUCTION_UNIT' && !resetsClock ? (
        <p className="rounded-control border-l-2 border-brand-accent bg-surface-sunken px-4 py-2.5 text-[13px] text-text-secondary">
          This is recorded, but it does not reset the cleaning interval on the house — only
          a disinfect, a fumigate or a full turnaround does.
        </p>
      ) : null}

      <Field
        label="Done by"
        htmlFor="performedBy"
        error={e.performedBy}
        hint="Whoever did the work, whether or not they have an account here."
      >
        <TextInput
          id="performedBy"
          name="performedBy"
          value={performedBy}
          onChange={(ev) => setPerformedBy(ev.target.value)}
          error={e.performedBy}
        />
      </Field>

      <fieldset className="rounded-card border border-border-default bg-surface-sunken p-4">
        <legend className="px-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-accent">
          What was used
        </legend>
        <p className="mt-2 text-[13px] text-text-secondary">
          Naming a product takes it off the store as well as recording it here.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Product" htmlFor="itemId" error={e.itemId}>
            <Select
              id="itemId"
              name="itemId"
              value={itemId}
              onChange={(ev) => setItemId(ev.target.value)}
              error={e.itemId}
            >
              <option value="">Nothing from the store</option>
              {options.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={`How much${product ? ` (${product.unitKey})` : ''}`}
            htmlFor="quantity"
            error={e.quantity}
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
        </div>

        {itemId ? (
          <div className="mt-4">
            <Field label="From which store" htmlFor="stockLocationId" required error={e.stockLocationId}>
              <Select
                id="stockLocationId"
                name="stockLocationId"
                value={storeId}
                onChange={(ev) => setStoreId(ev.target.value)}
                error={e.stockLocationId}
              >
                <option value="">Choose…</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : (
          <input type="hidden" name="stockLocationId" value="" />
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Dilution"
            htmlFor="dilution"
            error={e.dilution}
            hint="Copy it off the container — 1:200, 20 ml per litre."
          >
            <TextInput
              id="dilution"
              name="dilution"
              value={dilution}
              onChange={(ev) => setDilution(ev.target.value)}
              error={e.dilution}
            />
          </Field>
          <Field
            label="Contact time (minutes)"
            htmlFor="contactTimeMinutes"
            error={e.contactTimeMinutes}
            hint="How long it was left wet, where the label asks."
          >
            <TextInput
              id="contactTimeMinutes"
              name="contactTimeMinutes"
              type="number"
              inputMode="numeric"
              min="1"
              max="1440"
              value={contact}
              onChange={(ev) => setContact(ev.target.value)}
              error={e.contactTimeMinutes}
            />
          </Field>
        </div>
      </fieldset>

      <Field label="Notes" htmlFor="notes" error={e.notes}>
        <TextInput
          id="notes"
          name="notes"
          value={notes}
          onChange={(ev) => setNotes(ev.target.value)}
          error={e.notes}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Submit />
        <Link
          href="/biosecurity/cleaning"
          className="inline-flex min-h-touch items-center rounded-control px-4 text-[15px] font-semibold text-text-secondary hover:text-text-primary"
        >
          Done
        </Link>
      </div>
    </form>
  );
}
