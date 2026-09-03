'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import type { FormState } from '../sites/actions';

interface Props {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  houses: { id: string; name: string; code: string }[];
  /** The breed catalogue. Empty only if the seed has not run. */
  breeds: { id: string; name: string; hasStandard: boolean }[];
  suggestedCode: string;
  today: string;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Placing…' : 'Place flock'}
    </Button>
  );
}

export function PlacementForm({ action, houses, breeds, suggestedCode, today }: Props) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormError message={state.error} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Flock code" htmlFor="code" required error={e.code}>
          <TextInput
            id="code"
            name="code"
            defaultValue={suggestedCode}
            error={e.code}
            required
            autoCapitalize="characters"
          />
        </Field>
        <Field label="House" htmlFor="productionUnitId" required error={e.productionUnitId}>
          <Select id="productionUnitId" name="productionUnitId" required error={e.productionUnitId}>
            {houses.length === 0 ? <option value="">No houses — add one first</option> : null}
            {houses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} ({h.code})
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Date of hatch"
          htmlFor="dateOfHatch"
          required
          error={e.dateOfHatch}
          hint="Drives age, vaccination timing and every performance comparison."
        >
          <TextInput
            id="dateOfHatch"
            name="dateOfHatch"
            type="date"
            defaultValue={today}
            max={today}
            error={e.dateOfHatch}
            required
          />
        </Field>
        <Field
          label="Arrival date"
          htmlFor="arrivalDate"
          required
          error={e.arrivalDate}
          hint="When the birds reached the farm."
        >
          <TextInput
            id="arrivalDate"
            name="arrivalDate"
            type="date"
            defaultValue={today}
            max={today}
            error={e.arrivalDate}
            required
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Number received"
          htmlFor="quantity"
          required
          error={e.quantity}
          hint="What the supplier actually delivered, including any that were dead."
        >
          <TextInput
            id="quantity"
            name="quantity"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="2000"
            error={e.quantity}
            required
          />
        </Field>
        <Field
          label="Dead on arrival"
          htmlFor="deadOnArrival"
          error={e.deadOnArrival}
          hint="Recorded separately, so DOA% tells you about this supplier."
        >
          <TextInput
            id="deadOnArrival"
            name="deadOnArrival"
            type="number"
            inputMode="numeric"
            min={0}
            defaultValue={0}
            error={e.deadOnArrival}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Breed"
          htmlFor="breedId"
          error={e.breedId}
          hint="Chosen, not typed — a typed breed cannot be matched to a growth curve."
        >
          <Select id="breedId" name="breedId" error={e.breedId}>
            <option value="">Not recorded</option>
            {breeds.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.hasStandard ? '' : ' — no weight table loaded'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Supplier / hatchery" htmlFor="supplierName" error={e.supplierName}>
          <TextInput id="supplierName" name="supplierName" error={e.supplierName} />
        </Field>
      </div>

      <Field
        label="Total paid for the chicks (GHS)"
        htmlFor="purchaseCostCedis"
        error={e.purchaseCostCedis}
        hint="Starts this flock's cost ledger — the basis for cost per point-of-lay pullet."
      >
        <TextInput
          id="purchaseCostCedis"
          name="purchaseCostCedis"
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          error={e.purchaseCostCedis}
        />
      </Field>

      <Field label="Notes" htmlFor="notes" error={e.notes}>
        <TextInput id="notes" name="notes" error={e.notes} />
      </Field>

      <div className="flex items-center gap-3 pt-1">
        <Submit />
        <Link
          href="/flocks"
          className="inline-flex min-h-touch items-center rounded-control px-4 text-[15px] font-semibold text-text-secondary hover:text-text-primary"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
