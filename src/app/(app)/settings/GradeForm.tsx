'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import type { FormState } from '../sites/actions';

interface Props {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  /** Set when editing an existing grade; blank when adding a new one. */
  defaults?: {
    name: string;
    isSaleable: boolean;
    minGrams: number | null;
    maxGrams: number | null;
    itemId: string | null;
  };
  /** Store items this grade could be held as, plus whichever it already is. */
  items: { id: string; name: string; sku: string }[];
  submitLabel: string;
  idPrefix: string;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}

/**
 * Add or edit one grade.
 *
 * "Can be sold" is a DROPDOWN, NOT A CHECKBOX. React 19 resets a form's DOM
 * after a server action and restores a controlled input but not a checkbox — the
 * box snaps back while React state still holds the real answer, and the next
 * submit sends the wrong one. `Select` already carries its value on a hidden
 * input for exactly this reason. It also reads better on a phone, where the two
 * answers are worth spelling out.
 *
 * The weight boundaries are left blank until the farm sets them. A band shipped
 * with the software would be trusted, and eggs would be sorted to a line nobody
 * here chose.
 */
export function GradeForm({ action, defaults, items, submitLabel, idPrefix }: Props) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const e = state.fieldErrors ?? {};

  const [values, setValues] = useState({
    name: defaults?.name ?? '',
    isSaleable: String(defaults?.isSaleable ?? true),
    minGrams: defaults?.minGrams === null || defaults === undefined ? '' : String(defaults.minGrams),
    maxGrams: defaults?.maxGrams === null || defaults === undefined ? '' : String(defaults.maxGrams),
    itemId: defaults?.itemId ?? '',
  });
  const set = (key: keyof typeof values) => (v: string) =>
    setValues((prev) => ({ ...prev, [key]: v }));

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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Grade name" htmlFor={`${idPrefix}-name`} required error={e.name}>
          <TextInput
            id={`${idPrefix}-name`}
            name="name"
            value={values.name}
            onChange={(ev) => set('name')(ev.target.value)}
            placeholder="Extra large"
            error={e.name}
            required
          />
        </Field>

        <Field label="Can be sold" htmlFor={`${idPrefix}-saleable`} required error={e.isSaleable}>
          <Select
            id={`${idPrefix}-saleable`}
            name="isSaleable"
            value={values.isSaleable}
            onChange={(ev) => set('isSaleable')(ev.target.value)}
            error={e.isSaleable}
          >
            <option value="true">Yes — counts towards saleable eggs</option>
            <option value="false">No — cracked, dirty or otherwise unsaleable</option>
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Smallest weight"
          htmlFor={`${idPrefix}-min`}
          hint="Grams. Leave blank until your buyer's bands are agreed."
          error={e.minGrams}
        >
          <TextInput
            id={`${idPrefix}-min`}
            name="minGrams"
            type="number"
            inputMode="numeric"
            min="1"
            max="500"
            value={values.minGrams}
            onChange={(ev) => set('minGrams')(ev.target.value)}
            placeholder="—"
            error={e.minGrams}
          />
        </Field>
        <Field label="Largest weight" htmlFor={`${idPrefix}-max`} hint="Grams." error={e.maxGrams}>
          <TextInput
            id={`${idPrefix}-max`}
            name="maxGrams"
            type="number"
            inputMode="numeric"
            min="1"
            max="500"
            value={values.maxGrams}
            onChange={(ev) => set('maxGrams')(ev.target.value)}
            placeholder="—"
            error={e.maxGrams}
          />
        </Field>
      </div>

      {/*
        The link that turns a collection into stock. Left blank by default and
        described as optional, because a farm that has not set up store items
        yet must still be able to record what it collected — and cracked eggs
        will never want one at all.
      */}
      <Field
        label="Held in the store as"
        htmlFor={`${idPrefix}-item`}
        hint="Choose an item and collections of this grade are added to the store automatically. Leave it blank and the grade is still recorded and counted, it simply does not become stock."
        error={e.itemId}
      >
        <Select
          id={`${idPrefix}-item`}
          name="itemId"
          value={values.itemId}
          onChange={(ev) => set('itemId')(ev.target.value)}
          error={e.itemId}
        >
          <option value="">Not held as stock</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.sku})
            </option>
          ))}
        </Select>
      </Field>

      <Submit label={submitLabel} />
    </form>
  );
}
