'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { saveProduct, savePrice, toggleActive, type ProductFormState } from './actions';

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ProductForm({
  productId,
  grades,
  defaults,
}: {
  productId: string | null;
  grades: { id: string; name: string; isSaleable: boolean }[];
  defaults: {
    sku: string;
    name: string;
    gradeId: string;
    unitsPerPack: string;
    packLabel: string;
    notes: string;
  };
}) {
  const [state, formAction] = useActionState(
    saveProduct.bind(null, productId),
    {} as ProductFormState,
  );
  /**
   * EVERY FIELD IS CONTROLLED, and that is not a style preference.
   *
   * React 19 resets an uncontrolled input to its `defaultValue` when a form
   * action returns — so a rejected product code emptied the name, the code and
   * the notes, and whoever was typing lost the lot and had to start again. The
   * browser suite found it by mistyping a code on purpose.
   *
   * This is the tenth time this shape has appeared in this codebase. The rule,
   * written down again: any field on a form that can be rejected holds its value
   * in state.
   */
  const [sku, setSku] = useState(defaults.sku);
  const [name, setName] = useState(defaults.name);
  const [gradeId, setGradeId] = useState(defaults.gradeId);
  const [unitsPerPack, setUnitsPerPack] = useState(defaults.unitsPerPack);
  const [packLabel, setPackLabel] = useState(defaults.packLabel);
  const [notes, setNotes] = useState(defaults.notes);
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormError message={state.error} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name" htmlFor="name" required error={e.name}>
          <TextInput
            id="name"
            name="name"
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            placeholder="Crate of 30 — Large"
            error={e.name}
          />
        </Field>
        <Field
          label="Code"
          htmlFor="sku"
          required
          error={e.sku}
          hint="Short, no spaces. Appears on reports and exports."
        >
          <TextInput
            id="sku"
            name="sku"
            value={sku}
            onChange={(ev) => setSku(ev.target.value)}
            placeholder="CRATE-L"
            error={e.sku}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="How many in one"
          htmlFor="unitsPerPack"
          required
          error={e.unitsPerPack}
          hint="A crate of thirty is 30. This is what lets the farm count eggs sold from a list of crates."
        >
          <TextInput
            id="unitsPerPack"
            name="unitsPerPack"
            inputMode="numeric"
            value={unitsPerPack}
            onChange={(ev) => setUnitsPerPack(ev.target.value)}
            error={e.unitsPerPack}
          />
        </Field>
        <Field
          label="What one is called"
          htmlFor="packLabel"
          required
          error={e.packLabel}
          hint="crate · tray · bird"
        >
          <TextInput
            id="packLabel"
            name="packLabel"
            value={packLabel}
            onChange={(ev) => setPackLabel(ev.target.value)}
            error={e.packLabel}
          />
        </Field>
      </div>

      <Field
        label="Drawn from which grade"
        htmlFor="gradeId"
        error={e.gradeId}
        hint="Leave blank for anything that is not graded produce — a spent hen, for instance."
      >
        <Select
          id="gradeId"
          name="gradeId"
          value={gradeId}
          onChange={(ev) => setGradeId(ev.target.value)}
        >
          <option value="">Not graded produce</option>
          {grades.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
              {g.isSaleable ? '' : ' (not saleable)'}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Notes" htmlFor="notes" error={e.notes}>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          value={notes}
          onChange={(ev) => setNotes(ev.target.value)}
          className="w-full rounded-control border border-border-strong bg-surface-card px-3 py-2.5 text-[16px] text-text-primary outline-none transition-colors focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
        />
      </Field>

      <div className="flex items-center gap-3 pt-1">
        <Submit label={productId ? 'Save changes' : 'Add product'} busy="Saving…" />
        <Link
          href={productId ? `/pricing/${productId}` : '/pricing'}
          className="inline-flex min-h-touch items-center rounded-control px-4 text-[15px] font-semibold text-text-secondary hover:text-text-primary"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

/**
 * Setting a price.
 *
 * THE FORM STAYS OPEN AFTER A SUCCESSFUL SAVE, unlike most in this codebase.
 * Prices are entered in runs — a new list price and then three buyer agreements
 * off the back of it — and closing after each one would mean reopening it three
 * times. The new row appearing in the history above is the confirmation.
 */
export function PriceForm({
  productId,
  customers,
  packLabel,
}: {
  productId: string;
  customers: { id: string; name: string; businessName: string | null }[];
  packLabel: string;
}) {
  const [state, formAction] = useActionState(savePrice, {} as ProductFormState);
  const [customerId, setCustomerId] = useState('');
  // Controlled for the same reason as above — a rejected price used to empty the
  // amount and the note, on a form people fill in several times in a row.
  const [price, setPrice] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [note, setNote] = useState('');
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="productId" value={productId} />
      <FormError message={state.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Who pays this"
          htmlFor="customerId"
          error={e.customerId}
          hint="The list price is what anybody pays. A buyer's own price beats it."
        >
          <Select
            id="customerId"
            name="customerId"
            value={customerId}
            onChange={(ev) => setCustomerId(ev.target.value)}
          >
            <option value="">Everybody — the list price</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.businessName ? `${c.businessName} · ${c.name}` : c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={`Price per ${packLabel}`}
          htmlFor="price"
          error={e.price}
          hint={
            customerId
              ? 'In cedis. Leave blank to end this buyer’s agreement and put them back on the list price.'
              : 'In cedis, like 45 or 45.50.'
          }
        >
          <TextInput
            id="price"
            name="price"
            inputMode="decimal"
            placeholder="45.00"
            value={price}
            onChange={(ev) => setPrice(ev.target.value)}
            error={e.price}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="From when"
          htmlFor="effectiveFrom"
          required
          error={e.effectiveFrom}
          hint="Backdating is fine — a price agreed last Tuesday is Tuesday’s price."
        >
          <TextInput
            id="effectiveFrom"
            name="effectiveFrom"
            type="date"
            value={effectiveFrom}
            onChange={(ev) => setEffectiveFrom(ev.target.value)}
            error={e.effectiveFrom}
          />
        </Field>
        <Field label="Note" htmlFor="note" error={e.note} hint="Why, or what was agreed.">
          <TextInput
            id="note"
            name="note"
            placeholder="Held for the quarter"
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
            error={e.note}
          />
        </Field>
      </div>

      <Submit label="Set price" busy="Saving…" />
    </form>
  );
}

export function ActiveForm({
  productId,
  isActive,
}: {
  productId: string;
  isActive: boolean;
}) {
  const [state, formAction] = useActionState(
    toggleActive.bind(null, productId, !isActive),
    {} as ProductFormState,
  );
  return (
    <form action={formAction}>
      <FormError message={state.error} />
      <Submit
        label={isActive ? 'Take off the list' : 'Put back on the list'}
        busy="…"
      />
    </form>
  );
}
