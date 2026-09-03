'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { CollectionFormState } from './actions';

interface Props {
  action: (prev: CollectionFormState, formData: FormData) => Promise<CollectionFormState>;
  today: string;
  idempotencyKey: string;
  sequence: number;
  population: number;
  /** The words this species uses — "Eggs", "Birds", "House". */
  words: { production: string; productionSingular: string; animalPlural: string };
  grades: { id: string; name: string; isSaleable: boolean }[];
  units: { key: string; label: string }[];
  dispositions: { key: string; label: string }[];
  /** Set while a withdrawal period stands. Sale is then not on offer at all. */
  eggsClearOn: string | null;
  /** Yesterday's whole-day figure, shown as a hint. */
  previousTotal: number | null;
}

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
      {pending ? 'Saving…' : confirming ? 'Yes, this is correct — save' : 'Save this collection'}
    </button>
  );
}

/**
 * One collection, recorded where it happened.
 *
 * Built for a phone held in one hand at the end of a walk down the house. One
 * big box for what was counted, a row per grade if the eggs are graded there,
 * and nothing else required. A collection that was only counted is a complete
 * record; so is one that was only graded.
 *
 * EVERY FIELD IS CONTROLLED, and the DOM is put back after each response. React
 * resets a form when a server action returns: controlled inputs are restored
 * from state, but a <select> is not — it snaps back to its first option while
 * state still holds the real choice, and the next submit sends the wrong one.
 * That matters most here, because the warn-and-confirm flow asks people to
 * submit twice, and the wrong value would be the one that says these eggs may
 * be sold.
 */
export function CollectionForm({
  action,
  today,
  idempotencyKey,
  sequence,
  population,
  words,
  grades,
  units,
  dispositions,
  eggsClearOn,
  previousTotal,
}: Props) {
  const [state, formAction] = useActionState(action, {} as CollectionFormState);

  const blank = {
    counted: '',
    unit: 'piece',
    // Under a withdrawal, sale is not the default and not on offer.
    disposition: eggsClearOn ? 'HELD' : 'SALEABLE',
    dispositionNote: '',
    notes: '',
    ...Object.fromEntries(grades.map((g) => [`grade_${g.id}`, ''])),
  };
  const [values, setValues] = useState<Record<string, string>>(blank);
  const set = (key: string) => (v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const formRef = useRef<HTMLFormElement>(null);

  /**
   * Clear the form once a collection has actually been saved, so the next walk
   * of the house starts empty rather than with the last one's figures still in
   * the boxes — which is exactly how the same collection gets entered twice.
   *
   * Adjusted DURING RENDER rather than in an effect. React re-runs this render
   * immediately with the new state, before anything reaches the screen, so there
   * is no flash of the old figures — and an effect that calls setState would
   * render the stale values first and then correct them.
   */
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const savedSequence = state.saved?.sequence ?? null;
  if (savedSequence !== null && savedSequence !== lastSaved) {
    setLastSaved(savedSequence);
    setValues(blank);
  }

  // Put the DOM back to what state says after every response. See the note above.
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
  const errors = state.fieldErrors ?? {};

  const gradedTotal = grades.reduce((sum, g) => {
    const raw = Number(values[`grade_${g.id}`]);
    return Number.isFinite(raw) ? sum + raw : sum;
  }, 0);

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

      {state.saved ? (
        <p
          role="status"
          className="rounded-control border border-status-positive bg-brand-primary-soft px-4 py-3 text-[15px] font-medium text-brand-primary"
        >
          Collection {state.saved.sequence} saved —{' '}
          {state.saved.total.toLocaleString('en-GH')} {lower(words.production)}.
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

      <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor="counted" className="block text-[15px] font-semibold text-text-primary">
            {words.production} counted{' '}
            <span className="font-normal text-text-muted">collection {sequence}</span>
          </label>
          <input
            id="counted"
            name="counted"
            type="number"
            inputMode="decimal"
            step="1"
            min="0"
            placeholder="—"
            value={values.counted}
            onChange={(e) => set('counted')(e.target.value)}
            aria-invalid={errors.counted ? true : undefined}
            className="mt-1.5 min-h-[60px] w-full rounded-control border border-border-strong bg-surface-card px-4 text-[22px] font-semibold tabular-nums text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
          />
          {errors.counted ? (
            <p className="mt-1 text-[13px] text-status-critical">{errors.counted}</p>
          ) : (
            <p className="mt-1 text-[13px] text-text-muted">
              {previousTotal === null
                ? `${population.toLocaleString('en-GH')} ${lower(words.animalPlural)} in the house`
                : `Yesterday, all day: ${previousTotal.toLocaleString('en-GH')}`}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="unit" className="block text-[15px] font-semibold text-text-primary">
            Counted in
          </label>
          <select
            id="unit"
            name="unit"
            value={values.unit}
            onChange={(e) => set('unit')(e.target.value)}
            className="mt-1.5 min-h-[60px] w-full rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25 sm:w-[160px]"
          >
            {units.map((u) => (
              <option key={u.key} value={u.key}>
                {u.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[13px] text-text-muted">Applies to every box.</p>
        </div>
      </div>

      {grades.length > 0 ? (
        <fieldset className="rounded-card border border-border-default bg-surface-sunken p-4">
          <legend className="px-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-accent">
            How it graded
          </legend>
          <p className="mt-1 text-[13px] text-text-muted">
            Leave these blank if grading happens later. A collection that was only counted is a
            complete record.
          </p>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {grades.map((grade) => {
              const field = `grade_${grade.id}`;
              return (
                <div key={grade.id}>
                  <label
                    htmlFor={field}
                    className="block text-[14px] font-semibold text-text-primary"
                  >
                    {grade.name}
                    {grade.isSaleable ? null : (
                      <span className="ml-1.5 font-normal text-text-muted">not saleable</span>
                    )}
                  </label>
                  <input
                    id={field}
                    name={field}
                    type="number"
                    inputMode="decimal"
                    step="1"
                    min="0"
                    placeholder="—"
                    value={values[field] ?? ''}
                    onChange={(e) => set(field)(e.target.value)}
                    aria-invalid={errors[field] ? true : undefined}
                    className="mt-1 min-h-[56px] w-full rounded-control border border-border-strong bg-surface-card px-3 text-[18px] font-semibold tabular-nums text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
                  />
                  {errors[field] ? (
                    <p className="mt-1 text-[13px] text-status-critical">{errors[field]}</p>
                  ) : null}
                </div>
              );
            })}
          </div>

          {gradedTotal > 0 ? (
            <p className="mt-3 text-[13px] text-text-secondary">
              Graded so far: {gradedTotal.toLocaleString('en-GH')}
              {values.counted !== '' && Number(values.counted) !== gradedTotal
                ? ` · counted ${Number(values.counted).toLocaleString('en-GH')}. Both figures are kept.`
                : ''}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label
            htmlFor="disposition"
            className="block text-[15px] font-semibold text-text-primary"
          >
            What happens to it
          </label>
          <select
            id="disposition"
            name="disposition"
            value={values.disposition}
            onChange={(e) => set('disposition')(e.target.value)}
            className="mt-1.5 min-h-touch w-full rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
          >
            {dispositions.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
          {eggsClearOn ? (
            <p className="mt-1 text-[13px] text-status-attention">
              Sale is not on offer until {eggsClearOn} — withdrawal period.
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="dispositionNote"
            className="block text-[15px] font-semibold text-text-primary"
          >
            Why <span className="font-normal text-text-muted">optional</span>
          </label>
          <input
            id="dispositionNote"
            name="dispositionNote"
            type="text"
            value={values.dispositionNote}
            onChange={(e) => set('dispositionNote')(e.target.value)}
            placeholder="Held for the withdrawal period"
            className="mt-1.5 min-h-touch w-full rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
          />
        </div>
      </div>

      <div>
        <label htmlFor="notes" className="block text-[15px] font-semibold text-text-primary">
          Anything you noticed <span className="font-normal text-text-muted">optional</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          value={values.notes}
          onChange={(e) => set('notes')(e.target.value)}
          placeholder="Two nests wet at the far end…"
          className="mt-1.5 w-full rounded-control border border-border-strong bg-surface-card px-3 py-2.5 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
        />
      </div>

      <Submit confirming={confirming} />
    </form>
  );
}

function lower(word: string): string {
  return word.toLocaleLowerCase('en-GH');
}
