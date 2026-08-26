'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { ITEM_CATEGORIES, CATEGORY_META, deriveSku, type ItemCategory } from '@/lib/validation/item';
import type { FormState } from './actions';

export interface UnitOption {
  key: string;
  name: string;
  symbol: string;
  dimension: string;
}

interface ItemFormProps {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  units: UnitOption[];
  defaults?: {
    name?: string;
    category?: string;
    sku?: string;
    stockUomKey?: string;
    /** Already converted back into the item's own unit by the page. */
    reorderLevel?: number | null;
    minimumStock?: number | null;
    isPerishable?: boolean;
  };
  /** Set when the item already has movements — the dimension is then fixed. */
  lockedDimension?: string;
  submitLabel: string;
  cancelHref: string;
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
 * Every field is CONTROLLED.
 *
 * React 19 resets a form after a successful server action, which restores an
 * uncontrolled `<input>` from its `defaultValue` but leaves an uncontrolled
 * `<select>` showing the old option while the DOM value underneath has been
 * cleared. On the daily record that meant a chosen cause of death silently
 * saving as none. The fix, applied here from the start, is to hold every value
 * in state.
 */
export function ItemForm({
  action,
  units,
  defaults = {},
  lockedDimension,
  submitLabel,
  cancelHref,
}: ItemFormProps) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const e = state.fieldErrors ?? {};

  const initialCategory = (defaults.category as ItemCategory) ?? 'FEED';

  const [name, setName] = useState(defaults.name ?? '');
  const [category, setCategory] = useState<ItemCategory>(initialCategory);
  const [sku, setSku] = useState(defaults.sku ?? '');
  const [unitKey, setUnitKey] = useState(
    () =>
      defaults.stockUomKey ??
      CATEGORY_META[initialCategory].suggestedUnits.find((k) =>
        units.some((u) => u.key === k),
      ) ??
      '',
  );
  const [reorderLevel, setReorderLevel] = useState(
    defaults.reorderLevel === null || defaults.reorderLevel === undefined
      ? ''
      : String(defaults.reorderLevel),
  );
  const [minimumStock, setMinimumStock] = useState(
    defaults.minimumStock === null || defaults.minimumStock === undefined
      ? ''
      : String(defaults.minimumStock),
  );
  const [isPerishable, setIsPerishable] = useState(
    defaults.isPerishable ?? CATEGORY_META[initialCategory].perishableByDefault,
  );

  const meta = CATEGORY_META[category];

  // On a NEW item, choosing a category also proposes a unit and whether the
  // thing expires. Done in the event handler rather than an effect: this is a
  // consequence of a person choosing something, not state to be synchronised,
  // and an effect here would re-render twice for every keystroke elsewhere.
  //
  // Never on an EXISTING item. Overwriting the unit a storekeeper already chose
  // because they came back to fix a typo in the category would be rude, and —
  // worse — silent.
  const isNew = defaults.stockUomKey === undefined;

  function chooseCategory(next: ItemCategory) {
    setCategory(next);
    if (!isNew) return;
    const nextMeta = CATEGORY_META[next];
    const suggested = nextMeta.suggestedUnits.find((k) => units.some((u) => u.key === k));
    if (suggested) setUnitKey(suggested);
    setIsPerishable(nextMeta.perishableByDefault);
  }

  const suggestedSku = useMemo(
    () => (name.trim().length >= 2 ? deriveSku(name, category) : ''),
    [name, category],
  );

  const selectedUnit = units.find((u) => u.key === unitKey);

  // Units of a different dimension are shown but disabled once history exists,
  // so the reason is visible rather than the option simply being missing.
  const grouped = useMemo(() => {
    const suggested = units.filter((u) => meta.suggestedUnits.includes(u.key));
    const rest = units.filter((u) => !meta.suggestedUnits.includes(u.key));
    return { suggested, rest };
  }, [units, meta]);

  const unitBlocked = (u: UnitOption) =>
    lockedDimension !== undefined && u.dimension !== lockedDimension;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormError message={state.error} />

      <Field label="Item name" htmlFor="name" required error={e.name}>
        <TextInput
          id="name"
          name="name"
          value={name}
          onChange={(ev) => setName(ev.target.value)}
          placeholder="Layer mash"
          error={e.name}
          required
        />
      </Field>

      <Field label="Category" htmlFor="category" required error={e.category} hint={meta.hint}>
        <Select
          id="category"
          name="category"
          value={category}
          onChange={(ev) => chooseCategory(ev.target.value as ItemCategory)}
          error={e.category}
        >
          {ITEM_CATEGORIES.map((key) => (
            <option key={key} value={key}>
              {CATEGORY_META[key].label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Stock unit"
        htmlFor="stockUomKey"
        required
        error={e.stockUomKey}
        hint={
          lockedDimension
            ? 'This item already has recorded movements, so it can only change to another unit of the same kind.'
            : 'What the farm buys and counts this in. Quantities are stored in the base unit either way.'
        }
      >
        <Select
          id="stockUomKey"
          name="stockUomKey"
          value={unitKey}
          onChange={(ev) => setUnitKey(ev.target.value)}
          error={e.stockUomKey}
          required
        >
          <option value="">Choose a unit</option>
          {grouped.suggested.length > 0 ? (
            <optgroup label={`Usual for ${meta.label.toLowerCase()}`}>
              {grouped.suggested.map((u) => (
                <option key={u.key} value={u.key} disabled={unitBlocked(u)}>
                  {u.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label="All units">
            {grouped.rest.map((u) => (
              <option key={u.key} value={u.key} disabled={unitBlocked(u)}>
                {u.name}
              </option>
            ))}
          </optgroup>
        </Select>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Reorder level"
          htmlFor="reorderLevel"
          error={e.reorderLevel}
          hint={selectedUnit ? `In ${selectedUnit.name.toLowerCase()}. Blank means no alert.` : undefined}
        >
          <TextInput
            id="reorderLevel"
            name="reorderLevel"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={reorderLevel}
            onChange={(ev) => setReorderLevel(ev.target.value)}
            error={e.reorderLevel}
          />
        </Field>

        <Field
          label="Minimum stock"
          htmlFor="minimumStock"
          error={e.minimumStock}
          hint="The level that counts as urgent."
        >
          <TextInput
            id="minimumStock"
            name="minimumStock"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={minimumStock}
            onChange={(ev) => setMinimumStock(ev.target.value)}
            error={e.minimumStock}
          />
        </Field>
      </div>

      <Field
        label="Item code"
        htmlFor="sku"
        error={e.sku}
        hint={
          suggestedSku && !sku
            ? `Leave blank and it will be saved as ${suggestedSku}.`
            : 'Your own reference, if you already number your stock.'
        }
      >
        <TextInput
          id="sku"
          name="sku"
          value={sku}
          onChange={(ev) => setSku(ev.target.value)}
          placeholder={suggestedSku}
          error={e.sku}
          autoCapitalize="characters"
        />
      </Field>

      <label className="flex items-start gap-3 rounded-control border border-border-default bg-surface-sunken p-3.5">
        <input
          type="checkbox"
          name="isPerishable"
          checked={isPerishable}
          onChange={(ev) => setIsPerishable(ev.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-border-strong accent-brand-primary"
        />
        <span>
          <span className="block text-sm font-semibold text-text-primary">
            This item expires
          </span>
          <span className="mt-0.5 block text-[13px] text-text-secondary">
            Receiving it will ask for a batch number and expiry date, and stock is issued
            shortest-dated first.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3 pt-1">
        <Submit label={submitLabel} />
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
