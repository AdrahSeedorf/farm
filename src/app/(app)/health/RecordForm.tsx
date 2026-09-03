'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { ROUTES, ROUTE_LABELS } from '@/lib/health-programme';
import { recordEvent, type HealthFormState } from './actions';

const TYPES = [
  ['VACCINATION', 'Vaccination'],
  ['MEDICATION', 'Medication'],
  ['SUPPLEMENT', 'Supplement'],
  ['TREATMENT', 'Treatment'],
  ['VET_VISIT', 'Vet visit'],
  ['DIAGNOSIS', 'Diagnosis'],
  ['POST_MORTEM', 'Post-mortem'],
  ['OTHER', 'Other'],
] as const;

export interface RecordItem {
  id: string;
  name: string;
  sku: string;
  baseUnit: string;
}

function Submit({ confirming }: { confirming: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Recording…' : confirming ? 'Yes, record it as entered' : 'Record it'}
    </Button>
  );
}

/**
 * Record something given to a flock.
 *
 * EVERY FIELD IS PREFILLED FROM THE PLAN AND EVERY FIELD IS EDITABLE. The
 * product actually used is not always the product planned — a different brand, a
 * different concentration, a different withdrawal period on the label — and a
 * form that only let you confirm the plan would quietly record a fiction.
 */
export function RecordForm({
  flockId,
  cancelHref,
  today,
  items,
  locations,
  defaults,
}: {
  flockId: string;
  cancelHref: string;
  today: string;
  items: RecordItem[];
  locations: { id: string; name: string }[];
  defaults: {
    programmeItemId: string | null;
    name: string;
    type: string;
    route: string;
    itemId: string;
    quantityBase: string;
    birdsTreated: string;
    eggWithdrawalDays: string;
    meatWithdrawalDays: string;
  };
}) {
  const [state, formAction] = useActionState(
    recordEvent.bind(null, flockId),
    {} as HealthFormState,
  );
  const e = state.fieldErrors ?? {};
  const warnings = state.warnings ?? [];
  const confirming = warnings.length > 0;

  const [name, setName] = useState(defaults.name);
  const [type, setType] = useState(defaults.type);
  const [occurredOn, setOccurredOn] = useState(today);
  const [route, setRoute] = useState(defaults.route);
  const [birdsTreated, setBirdsTreated] = useState(defaults.birdsTreated);
  const [itemId, setItemId] = useState(defaults.itemId);
  const [stockLocationId, setStockLocationId] = useState(locations[0]?.id ?? '');
  const [quantityBase, setQuantityBase] = useState(defaults.quantityBase);
  const [eggWithdrawalDays, setEgg] = useState(defaults.eggWithdrawalDays);
  const [meatWithdrawalDays, setMeat] = useState(defaults.meatWithdrawalDays);
  const [administeredBy, setAdministeredBy] = useState('');
  const [vetName, setVetName] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [notes, setNotes] = useState('');

  const item = items.find((i) => i.id === itemId);
  const isMedicine = type === 'MEDICATION' || type === 'TREATMENT';

  // Said before saving, not after: someone giving an antibiotic to a laying
  // flock needs to know at that moment that the eggs cannot go out.
  const restriction = (() => {
    const parts: string[] = [];
    const on = (days: number) => {
      const d = new Date(`${occurredOn}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const egg = Number(eggWithdrawalDays);
    const meat = Number(meatWithdrawalDays);
    if (eggWithdrawalDays !== '' && Number.isFinite(egg) && egg > 0) {
      parts.push(`eggs cannot be sold until ${on(egg)}`);
    }
    if (meatWithdrawalDays !== '' && Number.isFinite(meat) && meat > 0) {
      parts.push(`birds cannot be sold for meat until ${on(meat)}`);
    }
    return parts.length === 0 ? null : `After this, ${parts.join(', and ')}.`;
  })();

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormError message={state.error} />

      {confirming ? (
        <div
          role="alert"
          className="rounded-control border border-status-attention bg-status-attention-bg px-4 py-3"
        >
          <p className="text-[14px] font-semibold text-status-attention">
            Check this before recording
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[14px] text-status-attention">
            {warnings.map((w) => (
              <li key={`${w.field}:${w.message}`}>{w.message}</li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-status-attention">
            Nothing has been saved yet. Correct the entry, or record it as it stands.
          </p>
        </div>
      ) : null}
      <input type="hidden" name="acknowledgedToken" value={state.warningToken ?? ''} />
      {defaults.programmeItemId ? (
        <input type="hidden" name="programmeItemId" value={defaults.programmeItemId} />
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="What was given" htmlFor="name" required error={e.name}>
          <TextInput
            id="name"
            name="name"
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            error={e.name}
            required
          />
        </Field>
        <Field label="Type" htmlFor="type" required error={e.type}>
          <Select
            id="type"
            name="type"
            value={type}
            onChange={(ev) => setType(ev.target.value)}
            error={e.type}
          >
            {TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Given on" htmlFor="occurredOn" required error={e.occurredOn}>
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
        <Field label="Route" htmlFor="route" error={e.route}>
          <Select
            id="route"
            name="route"
            value={route}
            onChange={(ev) => setRoute(ev.target.value)}
            error={e.route}
          >
            <option value="">Not recorded</option>
            {ROUTES.map((r) => (
              <option key={r} value={r}>
                {ROUTE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Birds treated" htmlFor="birdsTreated" error={e.birdsTreated}>
          <TextInput
            id="birdsTreated"
            name="birdsTreated"
            type="number"
            inputMode="numeric"
            min="1"
            value={birdsTreated}
            onChange={(ev) => setBirdsTreated(ev.target.value)}
            error={e.birdsTreated}
          />
        </Field>
      </div>

      <fieldset className="rounded-card border border-border-default bg-surface-sunken p-4">
        <legend className="px-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-accent">
          Taken from the store
        </legend>
        <p className="mt-2 text-[13px] text-text-secondary">
          Optional. Filling it in takes the doses off the store and charges them to this
          flock — and records which batch the birds actually received, which is what
          matters if a batch is ever recalled.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Item" htmlFor="itemId" error={e.itemId}>
            <Select
              id="itemId"
              name="itemId"
              value={itemId}
              onChange={(ev) => setItemId(ev.target.value)}
              error={e.itemId}
            >
              <option value="">Not from the store</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.sku})
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={`How much${item ? ` (${item.baseUnit})` : ''}`}
            htmlFor="quantityBase"
            error={e.quantityBase}
          >
            <TextInput
              id="quantityBase"
              name="quantityBase"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={quantityBase}
              onChange={(ev) => setQuantityBase(ev.target.value)}
              error={e.quantityBase}
            />
          </Field>
          <Field label="From which store" htmlFor="stockLocationId" error={e.stockLocationId}>
            <Select
              id="stockLocationId"
              name="stockLocationId"
              value={stockLocationId}
              onChange={(ev) => setStockLocationId(ev.target.value)}
              error={e.stockLocationId}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </fieldset>

      <fieldset className="rounded-card border border-border-default bg-surface-sunken p-4">
        <legend className="px-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-accent">
          Withdrawal
        </legend>
        <p className="mt-2 text-[13px] text-text-secondary">
          From the label on the product you actually used — which is not always the one the
          programme planned. Blank means none was recorded, not that none applies.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Eggs (days)"
            htmlFor="eggWithdrawalDays"
            error={e.eggWithdrawalDays}
            hint={isMedicine ? 'Usually stated for a medication.' : undefined}
          >
            <TextInput
              id="eggWithdrawalDays"
              name="eggWithdrawalDays"
              type="number"
              inputMode="numeric"
              min="0"
              value={eggWithdrawalDays}
              onChange={(ev) => setEgg(ev.target.value)}
              error={e.eggWithdrawalDays}
            />
          </Field>
          <Field label="Meat (days)" htmlFor="meatWithdrawalDays" error={e.meatWithdrawalDays}>
            <TextInput
              id="meatWithdrawalDays"
              name="meatWithdrawalDays"
              type="number"
              inputMode="numeric"
              min="0"
              value={meatWithdrawalDays}
              onChange={(ev) => setMeat(ev.target.value)}
              error={e.meatWithdrawalDays}
            />
          </Field>
        </div>

        {restriction ? (
          <p
            role="status"
            className="mt-3 rounded-control border border-status-attention bg-status-attention-bg px-3.5 py-2.5 text-[14px] font-medium text-status-attention"
          >
            {restriction}
          </p>
        ) : null}
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Given by"
          htmlFor="administeredBy"
          error={e.administeredBy}
          hint="The person who physically gave it."
        >
          <TextInput
            id="administeredBy"
            name="administeredBy"
            value={administeredBy}
            onChange={(ev) => setAdministeredBy(ev.target.value)}
            error={e.administeredBy}
          />
        </Field>
        <Field label="Veterinarian" htmlFor="vetName" error={e.vetName}>
          <TextInput
            id="vetName"
            name="vetName"
            value={vetName}
            onChange={(ev) => setVetName(ev.target.value)}
            error={e.vetName}
          />
        </Field>
      </div>

      <Field label="Diagnosis" htmlFor="diagnosis" error={e.diagnosis}>
        <TextInput
          id="diagnosis"
          name="diagnosis"
          value={diagnosis}
          onChange={(ev) => setDiagnosis(ev.target.value)}
          error={e.diagnosis}
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

      <div className="flex items-center gap-3 pt-1">
        <Submit confirming={confirming} />
        <Link
          href={cancelHref}
          className="inline-flex min-h-touch items-center rounded-control px-4 text-[15px] font-semibold text-text-secondary hover:text-text-primary"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
