'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { DailyFormState } from './actions';

interface Props {
  action: (prev: DailyFormState, formData: FormData) => Promise<DailyFormState>;
  today: string;
  idempotencyKey: string;
  population: number;
  previous: {
    onDate: string;
    mortality: number;
    feedKg: number | null;
    waterLitres: number | null;
  } | null;
  mortalityReasons: { key: string; label: string }[];
  cullReasons: { key: string; label: string }[];
  /** Brooding questions are asked only while the flock still needs heat. */
  isBrooding: boolean;
  broodTargetC: number | null;
  chickBehaviours: { key: string; label: string }[];
  litterConditions: { key: string; label: string }[];
  /**
   * Where feed comes off the store. Empty when the farm has no stock set up —
   * the feed field then behaves exactly as it always has.
   */
  feedSources: {
    items: { id: string; name: string; onHandKg: number }[];
    locations: { id: string; name: string }[];
    defaultItemId: string | null;
    defaultLocationId: string | null;
  };
}

/**
 * The morning entry.
 *
 * Built for a phone held in one hand, in a poultry house, possibly with the
 * other hand full. Every input is a numeric keypad, every target is at least
 * 56px tall, and the whole form is four numbers and a note. Yesterday's figures
 * sit under each field as faint hints, because a number that is out of character
 * is far easier to spot beside the one before it than in isolation.
 *
 * Nothing is required. A morning where nothing died should take no typing at all.
 */

function Submit({ confirming }: { confirming: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`min-h-[60px] w-full rounded-control text-[17px] font-semibold transition-colors disabled:opacity-60 ${
        confirming
          ? 'bg-status-attention text-[#231A05] hover:brightness-95'
          : 'bg-brand-primary text-text-inverse hover:bg-brand-primary-hover'
      }`}
    >
      {pending ? 'Saving…' : confirming ? 'Yes, this is correct — save' : 'Save today’s record'}
    </button>
  );
}

function NumberField({
  id,
  name,
  label,
  hint,
  unit,
  placeholder = '0',
  step,
  value,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  unit?: string;
  placeholder?: string;
  step?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[15px] font-semibold text-text-primary">
        {label}
        {unit ? <span className="ml-1.5 font-normal text-text-muted">({unit})</span> : null}
      </label>
      <input
        id={id}
        name={name}
        type="number"
        inputMode="decimal"
        step={step ?? '1'}
        min="0"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 min-h-[60px] w-full rounded-control border border-border-strong bg-surface-card px-4 text-[22px] font-semibold tabular-nums text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
      />
      {hint ? <p className="mt-1 text-[13px] text-text-muted">{hint}</p> : null}
    </div>
  );
}

export function DailyForm({
  action,
  today,
  idempotencyKey,
  population,
  previous,
  mortalityReasons,
  cullReasons,
  isBrooding,
  broodTargetC,
  chickBehaviours,
  litterConditions,
  feedSources,
}: Props) {
  const [state, formAction] = useActionState(action, {} as DailyFormState);

  /**
   * EVERY FIELD IS CONTROLLED, DELIBERATELY.
   *
   * React resets a form after a server action completes. With uncontrolled
   * inputs that means the moment a warning appears, everything typed is wiped —
   * and pressing "yes, this is correct" would then save a BLANK record over an
   * entry someone had just carefully filled in.
   *
   * Holding the values in React state survives the round trip, so the warning
   * banner appears above exactly what was typed, still there to be corrected.
   */
  const [values, setValues] = useState({
    mortality: '',
    culls: '',
    feedKg: '',
    waterLitres: '',
    broodTempC: '',
    mortalityReason: '',
    cullReason: '',
    chickBehaviour: '',
    litterCondition: '',
    observations: '',
    feedItemId: feedSources.defaultItemId ?? '',
    feedStockLocationId: feedSources.defaultLocationId ?? '',
  });
  const set = (key: keyof typeof values) => (v: string) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  /**
   * Re-sync the DOM after every action response.
   *
   * React resets the form when a server action completes. For a controlled
   * <input> it then restores the value from state — but for a controlled
   * <select> it does NOT: React only writes the DOM when the `value` PROP
   * changes, and the prop did not change, so the browser's blank survives.
   *
   * The visible symptom is nasty and quiet: pick a cause of death, get a
   * warning, press confirm, and the record saves with no cause at all. So after
   * each response we put every field back to what state says it should be.
   */
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    for (const [name, value] of Object.entries(values)) {
      const field = form.elements.namedItem(name);
      if (
        (field instanceof HTMLSelectElement ||
          field instanceof HTMLInputElement ||
          field instanceof HTMLTextAreaElement) &&
        field.value !== value
      ) {
        field.value = value;
      }
    }
  }, [state, values]);

  const warnings = state.warnings ?? [];
  const confirming = warnings.length > 0;

  const yesterday = (value: number | null | undefined, unit = '') =>
    previous == null || value == null ? undefined : `Yesterday: ${value}${unit}`;

  return (
    <form ref={formRef} action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="onDate" value={today} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {state.error ? (
        <p
          role="alert"
          className="rounded-control border border-status-critical bg-status-critical-bg px-4 py-3 text-[15px] font-medium text-status-critical"
        >
          {state.error}
        </p>
      ) : null}

      {confirming ? (
        <div
          role="alert"
          className="rounded-card border border-status-attention bg-status-attention-bg px-4 py-3.5"
        >
          <p className="text-[15px] font-semibold text-[#6B4E12]">
            {warnings.length === 1 ? 'One figure looks unusual' : 'Some figures look unusual'}
          </p>
          <ul className="mt-2 space-y-1.5 text-[14px] text-[#6B4E12]">
            {warnings.map((w) => (
              <li key={`${w.field}-${w.message}`}>{w.message}</li>
            ))}
          </ul>
          <p className="mt-2.5 text-[13px] text-[#6B4E12]">
            Nothing has been saved yet. Correct it above, or save as entered — the farm records
            what happened, not what was expected.
          </p>
          <input type="hidden" name="acknowledgedToken" value={state.warningToken ?? ''} />
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <NumberField
          id="mortality"
          name="mortality"
          value={values.mortality}
          onChange={set('mortality')}
          label="Birds died"
          hint={yesterday(previous?.mortality) ?? `Flock holds ${population.toLocaleString('en-GH')}`}
        />
        <NumberField id="culls" name="culls" value={values.culls} onChange={set('culls')} label="Birds culled" hint="Put down deliberately" />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="mortalityReason" className="block text-[15px] font-semibold text-text-primary">
            Cause of death <span className="font-normal text-text-muted">optional</span>
          </label>
          <select
            id="mortalityReason"
            name="mortalityReason"
            value={values.mortalityReason}
            onChange={(event) => set('mortalityReason')(event.target.value)}
            className="mt-1.5 min-h-touch w-full rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
          >
            <option value="">Not specified</option>
            {mortalityReasons.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cullReason" className="block text-[15px] font-semibold text-text-primary">
            Reason for culling <span className="font-normal text-text-muted">optional</span>
          </label>
          <select
            id="cullReason"
            name="cullReason"
            value={values.cullReason}
            onChange={(event) => set('cullReason')(event.target.value)}
            className="mt-1.5 min-h-touch w-full rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
          >
            <option value="">Not specified</option>
            {cullReasons.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <NumberField
          id="feedKg"
          name="feedKg"
          value={values.feedKg}
          onChange={set('feedKg')}
          label="Feed given"
          unit="kg"
          step="0.1"
          placeholder="—"
          hint={yesterday(previous?.feedKg, ' kg')}
        />
        <NumberField
          id="waterLitres"
          name="waterLitres"
          value={values.waterLitres}
          onChange={set('waterLitres')}
          label="Water used"
          unit="litres"
          step="1"
          placeholder="—"
          hint={yesterday(previous?.waterLitres, ' L')}
        />
      </div>

      {/*
        Shown only once a feed figure has been typed, and only when the farm
        actually holds stock. Asking which bag it came from before anyone has
        said any feed was given is a question about nothing.
      */}
      {feedSources.items.length > 0 && Number(values.feedKg) > 0 ? (
        <fieldset className="rounded-card border border-border-default bg-surface-sunken p-4">
          <legend className="px-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-accent">
            Taken from
          </legend>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="feedItemId"
                className="block text-[15px] font-semibold text-text-primary"
              >
                Which feed
              </label>
              <select
                id="feedItemId"
                name="feedItemId"
                value={values.feedItemId}
                onChange={(e) => set('feedItemId')(e.target.value)}
                className="mt-1.5 min-h-[56px] w-full rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary"
              >
                <option value="">Not from the store</option>
                {feedSources.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} — {formatKg(i.onHandKg)} kg left
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="feedStockLocationId"
                className="block text-[15px] font-semibold text-text-primary"
              >
                From which store
              </label>
              <select
                id="feedStockLocationId"
                name="feedStockLocationId"
                value={values.feedStockLocationId}
                onChange={(e) => set('feedStockLocationId')(e.target.value)}
                className="mt-1.5 min-h-[56px] w-full rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary"
              >
                {feedSources.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="mt-2.5 text-[13px] text-text-muted">
            This takes the feed off the store and charges it to the flock. Choose &ldquo;not
            from the store&rdquo; if it came from somewhere else.
          </p>
        </fieldset>
      ) : null}

      {isBrooding ? (
        <fieldset className="rounded-card border border-border-default bg-surface-sunken p-4">
          <legend className="px-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-accent">
            Brooding
          </legend>

          <div className="mt-2 grid gap-5 sm:grid-cols-2">
            <NumberField
              id="broodTempC"
              name="broodTempC"
              value={values.broodTempC}
              onChange={set('broodTempC')}
              label="House temperature"
              unit="°C"
              step="0.1"
              placeholder="—"
              hint={broodTargetC !== null ? `Target today: ${broodTargetC}°C` : undefined}
            />

            <div>
              <label
                htmlFor="chickBehaviour"
                className="block text-[15px] font-semibold text-text-primary"
              >
                What the chicks are doing
              </label>
              <select
                id="chickBehaviour"
                name="chickBehaviour"
                value={values.chickBehaviour}
                onChange={(event) => set('chickBehaviour')(event.target.value)}
                className="mt-1.5 min-h-touch w-full rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
              >
                <option value="">Not recorded</option>
                {chickBehaviours.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[13px] text-text-muted">
                The birds are a better thermometer than the thermometer.
              </p>
            </div>
          </div>

          <div className="mt-5">
            <label
              htmlFor="litterCondition"
              className="block text-[15px] font-semibold text-text-primary"
            >
              Litter
            </label>
            <select
              id="litterCondition"
              name="litterCondition"
              value={values.litterCondition}
              onChange={(event) => set('litterCondition')(event.target.value)}
              className="mt-1.5 min-h-touch w-full rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
            >
              <option value="">Not recorded</option>
              {litterConditions.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
      ) : null}

      <div>
        <label htmlFor="observations" className="block text-[15px] font-semibold text-text-primary">
          Anything you noticed <span className="font-normal text-text-muted">optional</span>
        </label>
        <textarea
          id="observations"
          name="observations"
          rows={3}
          value={values.observations}
          onChange={(event) => set('observations')(event.target.value)}
          placeholder="Birds quiet at the far end, one drinker dripping…"
          className="mt-1.5 w-full rounded-control border border-border-strong bg-surface-card px-3 py-2.5 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
        />
      </div>

      <Submit confirming={confirming} />
    </form>
  );
}

function formatKg(value: number): string {
  return new Intl.NumberFormat('en-GH', { maximumFractionDigits: 1 }).format(value);
}
