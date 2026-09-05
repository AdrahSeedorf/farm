'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { addLine, type OrderFormState } from './actions';

/**
 * Add one line to a draft order.
 *
 * ONE LINE AT A TIME, not a grid of rows. A grid is a desktop idea; the person
 * building a feed order is holding a phone in a store, and a five-column table
 * at 390px is where mistyped quantities come from. It also means each line is
 * saved as it is entered, so a dropped connection costs one line rather than
 * the whole order.
 *
 * The unit picker defaults to how the item is counted and is NARROWED, not
 * restricted, to units that measure the same thing. Ordering feed by the litre
 * cannot be matched against a delivery weighed in kilograms, so that one is
 * genuinely refused; ordering in tonnes rather than bags is a real thing farms
 * do and is allowed.
 */

export interface ItemOption {
  id: string;
  name: string;
  sku: string;
  category: string;
  unitKey: string;
  dimension: string;
}

export interface UnitOption {
  key: string;
  name: string;
  dimension: string;
}

interface Props {
  orderId: string;
  items: ItemOption[];
  units: UnitOption[];
  /** Items already on the order — offered greyed out rather than silently missing. */
  usedItemIds: string[];
  /** Categories this supplier says they sell. Sorted first; nothing is hidden. */
  supplies: string[];
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Adding…' : 'Add to the order'}
    </Button>
  );
}

export function AddLineForm({ orderId, items, units, usedItemIds, supplies }: Props) {
  const [state, formAction] = useActionState(addLine.bind(null, orderId), {} as OrderFormState);
  const [itemId, setItemId] = useState('');
  const [unitKey, setUnitKey] = useState('');

  const e = state.fieldErrors ?? {};
  const item = items.find((i) => i.id === itemId) ?? null;
  const used = new Set(usedItemIds);

  // What the supplier sells comes first. Nothing is hidden — a farm buys the
  // odd thing from whoever has it, and a picker that refuses is a picker that
  // gets worked around by choosing the nearest wrong option.
  const supplied = new Set(supplies);
  const ordered = [...items].sort((a, b) => {
    const sa = supplied.has(a.category) ? 0 : 1;
    const sb = supplied.has(b.category) ? 0 : 1;
    return sa - sb || a.name.localeCompare(b.name);
  });

  const usable = item ? units.filter((u) => u.dimension === item.dimension) : units;
  const effectiveUnit = unitKey || item?.unitKey || '';

  function chooseItem(id: string) {
    setItemId(id);
    // Reset to the item's own unit so a leftover choice from the last line
    // cannot ride along onto a different item.
    setUnitKey('');
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormError message={state.error} />
      {state.ok ? (
        <p role="status" className="text-[13px] font-medium text-text-secondary">
          {state.ok}
        </p>
      ) : null}

      <Field label="Item" htmlFor="itemId" required error={e.itemId}>
        <Select
          id="itemId"
          name="itemId"
          value={itemId}
          onChange={(ev) => chooseItem(ev.target.value)}
          error={e.itemId}
        >
          <option value="">Choose an item</option>
          {ordered.map((i) => (
            <option key={i.id} value={i.id} disabled={used.has(i.id)}>
              {i.name}
              {used.has(i.id) ? ' — already on this order' : ''}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="How many" htmlFor="quantityOrdered" required error={e.quantityOrdered}>
          <TextInput
            id="quantityOrdered"
            name="quantityOrdered"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            error={e.quantityOrdered}
          />
        </Field>

        <Field label="Unit" htmlFor="orderUomKey" required error={e.orderUomKey}>
          <Select
            id="orderUomKey"
            name="orderUomKey"
            value={effectiveUnit}
            onChange={(ev) => setUnitKey(ev.target.value)}
            error={e.orderUomKey}
          >
            {item ? null : <option value="">Choose an item first</option>}
            {usable.map((u) => (
              <option key={u.key} value={u.key}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="Agreed price"
        htmlFor="unitPriceCedis"
        error={e.unitPriceCedis}
        hint={
          effectiveUnit
            ? `In cedis, per ${effectiveUnit}. Leave blank if the price was not agreed — plenty are settled on arrival.`
            : 'In cedis, per unit ordered. Leave blank if the price was not agreed.'
        }
      >
        <TextInput
          id="unitPriceCedis"
          name="unitPriceCedis"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          error={e.unitPriceCedis}
        />
      </Field>

      <Field label="Line note" htmlFor="notes" error={e.notes}>
        <TextInput id="notes" name="notes" error={e.notes} placeholder="Grower, not layer" />
      </Field>

      <Submit />
    </form>
  );
}
