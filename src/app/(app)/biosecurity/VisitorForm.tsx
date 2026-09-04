'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import {
  VISITOR_KINDS,
  VISITOR_KIND_LABELS,
  CONTACT_DECLARATIONS,
  DECLARATION_LABELS,
} from '@/lib/validation/biosecurity';
import { downtimeFor, downtimeSentence } from '@/lib/biosecurity';
import { logVisitor, type BiosecurityFormState } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Log the visit'}
    </Button>
  );
}

export interface SiteOption {
  id: string;
  name: string;
  visitorDowntimeHours: number | null;
}

/**
 * The gate book.
 *
 * Filled in standing up, on a phone, often one-handed. Everything except a name
 * and a kind is optional, and the questions are ordered the way they are
 * actually asked: who are you, why are you here, where have you been.
 *
 * The downtime sentence appears AS THEY TYPE, before saving. Learning that a
 * visitor is thirty hours inside the farm's rule is only useful while they are
 * still standing at the gate — afterwards it is a note about something that has
 * already happened.
 */
export function VisitorForm({
  sites,
  nowLocal,
}: {
  sites: SiteOption[];
  /** "2026-09-04T08:30" in the farm's own clock, from the server. */
  nowLocal: string;
}) {
  const [state, formAction] = useActionState(logVisitor, {} as BiosecurityFormState);
  const e = state.fieldErrors ?? {};

  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [name, setName] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [phone, setPhone] = useState('');
  const [kind, setKind] = useState<string>('SUPPLIER');
  const [purpose, setPurpose] = useState('');
  const [arrivedAt, setArrivedAt] = useState(nowLocal);
  const [declaration, setDeclaration] = useState<string>('NOT_DECLARED');
  const [lastContact, setLastContact] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [enteredUnit, setEnteredUnit] = useState('no');
  const [footbath, setFootbath] = useState('');
  const [clothing, setClothing] = useState('');
  const [notes, setNotes] = useState('');

  const site = sites.find((s) => s.id === siteId) ?? null;
  const rule = site?.visitorDowntimeHours ?? null;

  const preview = (() => {
    const arrived = new Date(`${arrivedAt}:00.000Z`);
    if (Number.isNaN(arrived.getTime())) return null;

    if (declaration === 'AT') {
      const at = new Date(`${lastContact}:00.000Z`);
      if (Number.isNaN(at.getTime())) return null;
      return downtimeSentence(downtimeFor({ kind: 'AT', at }, arrived, rule), rule);
    }
    if (declaration === 'NONE') {
      return downtimeSentence(downtimeFor({ kind: 'NONE' }, arrived, rule), rule);
    }
    return downtimeSentence(downtimeFor({ kind: 'NOT_DECLARED' }, arrived, rule), rule);
  })();

  const inside =
    preview !== null && /still to run/.test(preview);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <FormError message={state.error} />

      {sites.length > 1 ? (
        <Field label="Farm" htmlFor="siteId" required error={e.siteId}>
          <Select
            id="siteId"
            name="siteId"
            value={siteId}
            onChange={(ev) => setSiteId(ev.target.value)}
            error={e.siteId}
          >
            {sites.map((s) => (
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
        <Field label="Name" htmlFor="name" required error={e.name}>
          <TextInput
            id="name"
            name="name"
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            error={e.name}
            required
          />
        </Field>
        <Field label="Kind of visit" htmlFor="kind" required error={e.kind}>
          <Select
            id="kind"
            name="kind"
            value={kind}
            onChange={(ev) => setKind(ev.target.value)}
            error={e.kind}
          >
            {VISITOR_KINDS.map((k) => (
              <option key={k} value={k}>
                {VISITOR_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Company or farm" htmlFor="organisation" error={e.organisation}>
          <TextInput
            id="organisation"
            name="organisation"
            value={organisation}
            onChange={(ev) => setOrganisation(ev.target.value)}
            error={e.organisation}
          />
        </Field>
        <Field
          label="Phone"
          htmlFor="phone"
          error={e.phone}
          hint="However they give it. Kept as typed."
        >
          <TextInput
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(ev) => setPhone(ev.target.value)}
            error={e.phone}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Arrived" htmlFor="arrivedAt" required error={e.arrivedAt}>
          <TextInput
            id="arrivedAt"
            name="arrivedAt"
            type="datetime-local"
            value={arrivedAt}
            onChange={(ev) => setArrivedAt(ev.target.value)}
            error={e.arrivedAt}
            required
          />
        </Field>
        <Field label="Purpose" htmlFor="purpose" error={e.purpose}>
          <TextInput
            id="purpose"
            name="purpose"
            placeholder="Feed delivery"
            value={purpose}
            onChange={(ev) => setPurpose(ev.target.value)}
            error={e.purpose}
          />
        </Field>
      </div>

      <fieldset className="rounded-card border border-border-default bg-surface-sunken p-4">
        <legend className="px-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-accent">
          Where they have been
        </legend>
        <p className="mt-2 text-[13px] text-text-secondary">
          {rule === null
            ? 'This farm has no downtime rule set, so this is recorded and not measured against anything.'
            : `This farm asks for ${rule} hours clear of other poultry.`}{' '}
          Whatever is entered here is recorded as what they <em>said</em>, not as something
          checked.
        </p>

        <div className="mt-4 space-y-2">
          {CONTACT_DECLARATIONS.map((k) => (
            <label
              key={k}
              className={`flex cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors ${
                declaration === k
                  ? 'border-brand-primary bg-brand-primary/5'
                  : 'border-border-default bg-surface-card hover:bg-surface-sunken'
              }`}
            >
              <input
                type="radio"
                // Grouping only; the submitted value is the hidden input below.
                // See components/ui/form.tsx on React 19's post-action form reset.
                name="declarationChoice"
                value={k}
                checked={declaration === k}
                onChange={() => setDeclaration(k)}
                className="mt-0.5 h-4 w-4 accent-[var(--color-brand-primary)]"
              />
              <span className="text-[15px] text-text-primary">{DECLARATION_LABELS[k]}</span>
            </label>
          ))}
        </div>
        <input type="hidden" name="declaration" value={declaration} />

        {declaration === 'AT' ? (
          <div className="mt-4">
            <Field
              label="Last near other poultry"
              htmlFor="lastPoultryContactAt"
              required
              error={e.lastPoultryContactAt}
            >
              <TextInput
                id="lastPoultryContactAt"
                name="lastPoultryContactAt"
                type="datetime-local"
                max={arrivedAt}
                value={lastContact}
                onChange={(ev) => setLastContact(ev.target.value)}
                error={e.lastPoultryContactAt}
              />
            </Field>
          </div>
        ) : (
          <input type="hidden" name="lastPoultryContactAt" value="" />
        )}

        {/*
          Shown while they are still at the gate. Afterwards it is a note about
          something that has already happened.
        */}
        {preview ? (
          <p
            role="status"
            className={`mt-4 rounded-control px-3.5 py-2.5 text-[14px] ${
              inside
                ? 'border border-status-attention bg-status-attention-bg font-medium text-status-attention'
                : 'border border-border-default bg-surface-card text-text-secondary'
            }`}
          >
            {preview}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="rounded-card border border-border-default bg-surface-sunken p-4">
        <legend className="px-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-accent">
          What happened on the visit
        </legend>
        <p className="mt-2 text-[13px] text-text-secondary">
          Leave a question blank and it stays blank. &ldquo;Nobody recorded it&rdquo; and
          &ldquo;no&rdquo; are different answers.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Went into a house with birds" htmlFor="enteredProductionUnit">
            <Select
              id="enteredProductionUnit"
              name="enteredProductionUnit"
              value={enteredUnit}
              onChange={(ev) => setEnteredUnit(ev.target.value)}
            >
              <option value="no">No — stayed outside</option>
              <option value="yes">Yes</option>
            </Select>
          </Field>
          <Field label="Vehicle registration" htmlFor="vehicleRegistration" error={e.vehicleRegistration}>
            <TextInput
              id="vehicleRegistration"
              name="vehicleRegistration"
              value={vehicle}
              onChange={(ev) => setVehicle(ev.target.value)}
              error={e.vehicleRegistration}
              autoCapitalize="characters"
            />
          </Field>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Used the footbath" htmlFor="usedFootbath">
            <Select
              id="usedFootbath"
              name="usedFootbath"
              value={footbath}
              onChange={(ev) => setFootbath(ev.target.value)}
            >
              <option value="">Not recorded</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </Field>
          <Field label="Wore farm clothing" htmlFor="woreFarmClothing">
            <Select
              id="woreFarmClothing"
              name="woreFarmClothing"
              value={clothing}
              onChange={(ev) => setClothing(ev.target.value)}
            >
              <option value="">Not recorded</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
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
          href="/biosecurity"
          className="inline-flex min-h-touch items-center rounded-control px-4 text-[15px] font-semibold text-text-secondary hover:text-text-primary"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
