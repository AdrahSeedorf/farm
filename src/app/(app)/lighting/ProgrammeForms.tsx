'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import {
  MODE_HINTS,
  MODE_LABELS,
  SUPPLEMENT_MODES,
  type SupplementMode,
} from '@/lib/lighting';
import {
  changeSupplementMode,
  saveLightingStep,
  deleteLightingStep,
  type LightingFormState,
} from './actions';

/**
 * Editing a programme.
 *
 * TWO SEPARATE FORMS, not one. Where the extra hours go is a property of the
 * whole programme and changes every switch-on time at once; a step is one row.
 * Putting them in one form would mean correcting a typo in week 17 and silently
 * re-saving the operating mode with it.
 *
 * EVERY FIELD IS CONTROLLED. React 19 resets uncontrolled inputs when an action
 * returns, and this form is explicitly submitted twice whenever a warning comes
 * back — which, on the one warning that matters here, is exactly when losing the
 * typed values would be worst.
 */

function Submit({ confirming, label }: { confirming: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : confirming ? 'Yes, save it as it stands' : label}
    </Button>
  );
}

export function SupplementModeForm({
  programmeId,
  current,
}: {
  programmeId: string;
  current: SupplementMode;
}) {
  const [state, formAction] = useActionState(changeSupplementMode, {} as LightingFormState);
  const [mode, setMode] = useState<SupplementMode>(current);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormError message={state.error} />
      {state.ok ? (
        <p
          role="status"
          className="rounded-control border border-brand-primary bg-brand-primary-soft px-3.5 py-3 text-[14px] font-medium text-brand-primary"
        >
          {state.ok}
        </p>
      ) : null}

      <input type="hidden" name="programmeId" value={programmeId} />

      <Field
        label="Where the extra hours go"
        htmlFor="mode"
        required
        hint={MODE_HINTS[mode]}
        error={state.fieldErrors?.mode}
      >
        <Select
          id="mode"
          name="mode"
          value={mode}
          onChange={(ev) => setMode(ev.target.value as SupplementMode)}
          error={state.fieldErrors?.mode}
        >
          {SUPPLEMENT_MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_LABELS[m]}
            </option>
          ))}
        </Select>
      </Field>

      <Submit confirming={false} label="Save" />
    </form>
  );
}

export function StepForm({ programmeId }: { programmeId: string }) {
  const [state, formAction] = useActionState(saveLightingStep, {} as LightingFormState);
  const [ageDays, setAgeDays] = useState('');
  const [totalHours, setTotalHours] = useState('');
  const [lux, setLux] = useState('');
  const [note, setNote] = useState('');

  const e = state.fieldErrors ?? {};
  const confirming = Boolean(state.warnings?.length);
  const weeks = /^\d+$/.test(ageDays) ? Math.floor(Number(ageDays) / 7) : null;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormError message={state.error} />

      {state.ok ? (
        <p
          role="status"
          className="rounded-control border border-brand-primary bg-brand-primary-soft px-3.5 py-3 text-[14px] font-medium text-brand-primary"
        >
          {state.ok}
        </p>
      ) : null}

      {confirming ? (
        <div
          role="alert"
          className="rounded-control border border-status-attention bg-status-attention-bg px-3.5 py-3"
        >
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-status-attention">
            Read this before saving
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[14px] text-status-attention">
            {state.warnings!.map((w) => (
              <li key={`${w.field}:${w.message}`}>{w.message}</li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-status-attention">
            Nothing has been saved yet. If this is deliberate, save it — the birds belong to you
            and this software does not know them.
          </p>
        </div>
      ) : null}

      <input type="hidden" name="programmeId" value={programmeId} />
      <input type="hidden" name="acknowledged" value={state.warningToken ?? ''} />

      <div className="grid gap-5 sm:grid-cols-3">
        <Field
          label="From age (days)"
          htmlFor="ageDays"
          required
          hint={weeks !== null ? `Week ${weeks}` : 'Days, not weeks.'}
          error={e.ageDays}
        >
          <TextInput
            id="ageDays"
            name="ageDays"
            inputMode="numeric"
            value={ageDays}
            onChange={(ev) => setAgeDays(ev.target.value)}
            error={e.ageDays}
            className="tabular-nums"
          />
        </Field>

        <Field
          label="Hours of light"
          htmlFor="totalHours"
          required
          hint="Daylight and lamps together."
          error={e.totalHours}
        >
          <TextInput
            id="totalHours"
            name="totalHours"
            inputMode="decimal"
            value={totalHours}
            onChange={(ev) => setTotalHours(ev.target.value)}
            error={e.totalHours}
            className="tabular-nums"
          />
        </Field>

        <Field
          label="Lux at bird height"
          htmlFor="lux"
          hint="Leave blank if nobody has measured it."
          error={e.lux}
        >
          <TextInput
            id="lux"
            name="lux"
            inputMode="numeric"
            value={lux}
            onChange={(ev) => setLux(ev.target.value)}
            error={e.lux}
            className="tabular-nums"
          />
        </Field>
      </div>

      <Field label="Why this step" htmlFor="note" error={e.note}>
        <TextInput
          id="note"
          name="note"
          value={note}
          onChange={(ev) => setNote(ev.target.value)}
          error={e.note}
        />
      </Field>

      <Submit confirming={confirming} label="Save this step" />
    </form>
  );
}

export function RemoveStepButton({
  stepId,
  programmeId,
  ageDays,
}: {
  stepId: string;
  programmeId: string;
  ageDays: number;
}) {
  const [state, setState] = useState<LightingFormState>({});

  return (
    <form
      action={async () => {
        setState(await deleteLightingStep(stepId, programmeId));
      }}
    >
      <button
        type="submit"
        aria-label={`Remove the instruction for day ${ageDays}`}
        className="min-h-touch rounded-control px-3 text-[13px] font-semibold text-status-critical hover:bg-status-critical-bg"
      >
        Remove
      </button>
      {state.error ? (
        <p role="alert" className="text-[13px] text-status-critical">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
