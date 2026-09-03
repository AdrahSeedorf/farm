'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { EVENT_TYPES, ROUTES, ROUTE_LABELS } from '@/lib/health-programme';
import { addProgrammeItem, type HealthFormState } from './actions';

const TYPE_LABELS: Record<string, string> = {
  VACCINATION: 'Vaccination',
  MEDICATION: 'Medication',
  SUPPLEMENT: 'Supplement',
  TREATMENT: 'Treatment',
  OTHER: 'Other',
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Adding…' : 'Add entry'}
    </Button>
  );
}

export function ItemForm({
  programmeId,
  items,
}: {
  programmeId: string;
  /** Stock items this entry can draw from, when the farm holds one. */
  items: { id: string; name: string; sku: string }[];
}) {
  const [state, formAction] = useActionState(
    addProgrammeItem.bind(null, programmeId),
    {} as HealthFormState,
  );
  const e = state.fieldErrors ?? {};

  const [ageDays, setAgeDays] = useState('');
  const [name, setName] = useState('');
  const [eventType, setEventType] = useState('VACCINATION');
  const [route, setRoute] = useState('');
  const [dosePerBird, setDosePerBird] = useState('');
  const [windowDays, setWindowDays] = useState('2');
  const [eggWithdrawalDays, setEggWithdrawalDays] = useState('');
  const [meatWithdrawalDays, setMeatWithdrawalDays] = useState('');
  const [itemId, setItemId] = useState('');
  const [notes, setNotes] = useState('');

  const isMedicine = eventType === 'MEDICATION' || eventType === 'TREATMENT';

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormError message={state.error} />
      {state.ok ? (
        <p
          role="status"
          className="rounded-control border border-border-strong bg-surface-sunken px-3 py-2.5 text-sm font-medium text-text-primary"
        >
          {state.ok}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Age (days)" htmlFor="ageDays" required error={e.ageDays}>
          <TextInput
            id="ageDays"
            name="ageDays"
            type="number"
            inputMode="numeric"
            min="0"
            value={ageDays}
            onChange={(ev) => setAgeDays(ev.target.value)}
            error={e.ageDays}
            required
          />
        </Field>
        <div className="sm:col-span-3">
          <Field label="What is given" htmlFor="name" required error={e.name}>
            <TextInput
              id="name"
              name="name"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              placeholder="Newcastle (La Sota)"
              error={e.name}
              required
            />
          </Field>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Type" htmlFor="eventType" required error={e.eventType}>
          <Select
            id="eventType"
            name="eventType"
            value={eventType}
            onChange={(ev) => setEventType(ev.target.value)}
            error={e.eventType}
          >
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Route" htmlFor="route" error={e.route}>
          <Select
            id="route"
            name="route"
            value={route}
            onChange={(ev) => setRoute(ev.target.value)}
            error={e.route}
          >
            <option value="">Not stated</option>
            {ROUTES.map((r) => (
              <option key={r} value={r}>
                {ROUTE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Window (± days)"
          htmlFor="windowDays"
          error={e.windowDays}
          hint="Still on time."
        >
          <TextInput
            id="windowDays"
            name="windowDays"
            type="number"
            inputMode="numeric"
            min="0"
            value={windowDays}
            onChange={(ev) => setWindowDays(ev.target.value)}
            error={e.windowDays}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Dose per bird"
          htmlFor="dosePerBird"
          error={e.dosePerBird}
          hint="In the stock item's own unit — doses, millilitres, grams."
        >
          <TextInput
            id="dosePerBird"
            name="dosePerBird"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={dosePerBird}
            onChange={(ev) => setDosePerBird(ev.target.value)}
            error={e.dosePerBird}
          />
        </Field>
        <Field
          label="Drawn from the store"
          htmlFor="itemId"
          error={e.itemId}
          hint="Optional. Links this entry to stock, so giving it draws it down."
        >
          <Select
            id="itemId"
            name="itemId"
            value={itemId}
            onChange={(ev) => setItemId(ev.target.value)}
            error={e.itemId}
          >
            <option value="">Not linked to stock</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.sku})
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Egg withdrawal (days)"
          htmlFor="eggWithdrawalDays"
          error={e.eggWithdrawalDays}
          hint={
            isMedicine
              ? 'From the product label. Blank means nobody wrote one down — not that none applies.'
              : 'Only if the label states one.'
          }
        >
          <TextInput
            id="eggWithdrawalDays"
            name="eggWithdrawalDays"
            type="number"
            inputMode="numeric"
            min="0"
            value={eggWithdrawalDays}
            onChange={(ev) => setEggWithdrawalDays(ev.target.value)}
            error={e.eggWithdrawalDays}
          />
        </Field>
        <Field
          label="Meat withdrawal (days)"
          htmlFor="meatWithdrawalDays"
          error={e.meatWithdrawalDays}
        >
          <TextInput
            id="meatWithdrawalDays"
            name="meatWithdrawalDays"
            type="number"
            inputMode="numeric"
            min="0"
            value={meatWithdrawalDays}
            onChange={(ev) => setMeatWithdrawalDays(ev.target.value)}
            error={e.meatWithdrawalDays}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes" error={e.notes}>
        <TextInput
          id="notes"
          name="notes"
          value={notes}
          onChange={(ev) => setNotes(ev.target.value)}
          error={e.notes}
        />
      </Field>

      <Submit />
    </form>
  );
}
