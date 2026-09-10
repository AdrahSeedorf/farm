'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, FormError } from '@/components/ui/form';
import { Button } from '@/components/ui/form';
import { thresholdInBirdsSentence } from '@/lib/alerts';
import {
  updateFarmMortality,
  updateStageMortality,
  updateRecordHour,
  type ThresholdFormState,
} from './actions';

function Submit({ label = 'Save' }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}

/**
 * A live translation of the percentage into birds.
 *
 * THE ONE THING THAT MAKES THIS SCREEN SAFE TO USE. A percentage box is a place
 * where a stray zero hides: 0.25 and 0.025 look alike and mean five birds or
 * half a bird. Rendered beside the field as it is typed, a wrong figure is
 * obvious to anybody who has walked the house — which is the reader this page is
 * for.
 */
function InBirds({ value, population }: { value: string; population: number }) {
  const pct = Number(value);
  if (value.trim() === '' || !Number.isFinite(pct) || pct <= 0) return null;
  return (
    <p className="mt-1 text-[13px] text-text-secondary">
      {thresholdInBirdsSentence(pct, population)}
    </p>
  );
}

export function FarmMortalityForm({
  defaults,
  population,
}: {
  defaults: {
    mortalityAttentionPct: number;
    mortalityCriticalPct: number;
    mortalitySpikeMultiple: number;
    mortalitySpikeFloorDeaths: number;
  };
  population: number;
}) {
  const [state, formAction] = useActionState(updateFarmMortality, {} as ThresholdFormState);
  const [attention, setAttention] = useState(String(defaults.mortalityAttentionPct));
  const [critical, setCritical] = useState(String(defaults.mortalityCriticalPct));
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormError message={state.error} />
      {state.ok ? (
        <p role="status" className="text-[14px] font-medium text-text-primary">
          {state.ok}
        </p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Field
            label="Needs attention at"
            htmlFor="farm-attention"
            required
            error={e.attentionPct ?? e.mortalityAttentionPct}
            hint="Deaths in one day, as a percentage of the birds alive that morning."
          >
            <TextInput
              id="farm-attention"
              name="mortalityAttentionPct"
              inputMode="decimal"
              value={attention}
              onChange={(ev) => setAttention(ev.target.value)}
              error={e.attentionPct ?? e.mortalityAttentionPct}
            />
          </Field>
          <InBirds value={attention} population={population} />
        </div>

        <div>
          <Field
            label="Deal with today at"
            htmlFor="farm-critical"
            required
            error={e.mortalityCriticalPct}
          >
            <TextInput
              id="farm-critical"
              name="mortalityCriticalPct"
              inputMode="decimal"
              value={critical}
              onChange={(ev) => setCritical(ev.target.value)}
              error={e.mortalityCriticalPct}
            />
          </Field>
          <InBirds value={critical} population={population} />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="A spike is this many times the recent average"
          htmlFor="farm-multiple"
          required
          error={e.mortalitySpikeMultiple}
          hint="Compared against the mean of the previous seven days."
        >
          <TextInput
            id="farm-multiple"
            name="mortalitySpikeMultiple"
            inputMode="decimal"
            defaultValue={String(defaults.mortalitySpikeMultiple)}
            error={e.mortalitySpikeMultiple}
          />
        </Field>

        <Field
          label="…but never fewer than this many birds"
          htmlFor="farm-floor"
          required
          error={e.mortalitySpikeFloorDeaths}
          hint="Without this, three times an average of one bird a week is one dead bird."
        >
          <TextInput
            id="farm-floor"
            name="mortalitySpikeFloorDeaths"
            inputMode="numeric"
            defaultValue={String(defaults.mortalitySpikeFloorDeaths)}
            error={e.mortalitySpikeFloorDeaths}
          />
        </Field>
      </div>

      <Submit />
    </form>
  );
}

export function StageMortalityForm({
  stage,
  population,
}: {
  stage: {
    id: string;
    name: string;
    attentionPct: number | null;
    criticalPct: number | null;
  };
  population: number;
}) {
  const [state, formAction] = useActionState(updateStageMortality, {} as ThresholdFormState);
  const [attention, setAttention] = useState(
    stage.attentionPct === null ? '' : String(stage.attentionPct),
  );
  const [critical, setCritical] = useState(
    stage.criticalPct === null ? '' : String(stage.criticalPct),
  );
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="mt-3 space-y-3" noValidate>
      <input type="hidden" name="stageId" value={stage.id} />
      <FormError message={state.error} />
      {state.ok ? (
        <p role="status" className="text-[13px] font-medium text-text-primary">
          {state.ok}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Field
            label="Needs attention at"
            htmlFor={`stage-attention-${stage.id}`}
            error={e.attentionPct}
          >
            <TextInput
              id={`stage-attention-${stage.id}`}
              name="attentionPct"
              inputMode="decimal"
              placeholder="farm figure"
              value={attention}
              onChange={(ev) => setAttention(ev.target.value)}
              error={e.attentionPct}
            />
          </Field>
          <InBirds value={attention} population={population} />
        </div>
        <div>
          <Field
            label="Deal with today at"
            htmlFor={`stage-critical-${stage.id}`}
            error={e.criticalPct}
          >
            <TextInput
              id={`stage-critical-${stage.id}`}
              name="criticalPct"
              inputMode="decimal"
              placeholder="farm figure"
              value={critical}
              onChange={(ev) => setCritical(ev.target.value)}
              error={e.criticalPct}
            />
          </Field>
          <InBirds value={critical} population={population} />
        </div>
      </div>

      <Submit label={`Save ${stage.name}`} />
    </form>
  );
}

export function RecordHourForm({ defaultHour }: { defaultHour: number }) {
  const [state, formAction] = useActionState(updateRecordHour, {} as ThresholdFormState);
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormError message={state.error} />
      {state.ok ? (
        <p role="status" className="text-[14px] font-medium text-text-primary">
          {state.ok}
        </p>
      ) : null}
      <Field
        label="Records are due by"
        htmlFor="record-hour"
        required
        error={e.recordDueHour}
        hint="An hour of the day, farm time. Before this, a house with nothing written down is a morning still in progress."
      >
        <TextInput
          id="record-hour"
          name="recordDueHour"
          inputMode="numeric"
          defaultValue={String(defaultHour)}
          error={e.recordDueHour}
        />
      </Field>
      <Submit />
    </form>
  );
}
