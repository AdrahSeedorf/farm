'use client';

import { useActionState } from 'react';
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
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  unit?: string;
  placeholder?: string;
  step?: string;
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
}: Props) {
  const [state, formAction] = useActionState(action, {} as DailyFormState);
  const warnings = state.warnings ?? [];
  const confirming = warnings.length > 0;

  const yesterday = (value: number | null | undefined, unit = '') =>
    previous == null || value == null ? undefined : `Yesterday: ${value}${unit}`;

  return (
    <form action={formAction} className="space-y-5" noValidate>
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
          <input type="hidden" name="acknowledgeWarnings" value="on" />
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <NumberField
          id="mortality"
          name="mortality"
          label="Birds died"
          hint={yesterday(previous?.mortality) ?? `Flock holds ${population.toLocaleString('en-GH')}`}
        />
        <NumberField id="culls" name="culls" label="Birds culled" hint="Put down deliberately" />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="mortalityReason" className="block text-[15px] font-semibold text-text-primary">
            Cause of death <span className="font-normal text-text-muted">optional</span>
          </label>
          <select
            id="mortalityReason"
            name="mortalityReason"
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
          label="Feed given"
          unit="kg"
          step="0.1"
          placeholder="—"
          hint={yesterday(previous?.feedKg, ' kg')}
        />
        <NumberField
          id="waterLitres"
          name="waterLitres"
          label="Water used"
          unit="litres"
          step="1"
          placeholder="—"
          hint={yesterday(previous?.waterLitres, ' L')}
        />
      </div>

      <div>
        <label htmlFor="observations" className="block text-[15px] font-semibold text-text-primary">
          Anything you noticed <span className="font-normal text-text-muted">optional</span>
        </label>
        <textarea
          id="observations"
          name="observations"
          rows={3}
          placeholder="Birds quiet at the far end, one drinker dripping…"
          className="mt-1.5 w-full rounded-control border border-border-strong bg-surface-card px-3 py-2.5 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
        />
      </div>

      <Submit confirming={confirming} />
    </form>
  );
}
