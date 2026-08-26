'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, FormError, Button } from '@/components/ui/form';
import { parseWeights } from '@/lib/validation/weight';
import { averageWeightGrams, uniformityCvPct, round } from '@/lib/metrics';
import type { FormState } from '../sites/actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save sample'}
    </Button>
  );
}

/**
 * Recording a weight sample.
 *
 * The live preview under the field is the point of this screen. Standing in the
 * house, you can see the average and the spread before you leave — so a bad
 * uniformity figure prompts a second look at the birds while you are still
 * standing among them, rather than a week later at a desk.
 */
export function WeightForm({
  action,
  today,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  today: string;
}) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const [typed, setTyped] = useState('');
  const [manual, setManual] = useState(false);
  const e = state.fieldErrors ?? {};

  const { weights, rejected } = parseWeights(typed);
  const average = averageWeightGrams(weights);
  const cv = uniformityCvPct(weights);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormError message={state.error} />

      <Field label="Date weighed" htmlFor="takenOn" required error={e.takenOn}>
        <TextInput
          id="takenOn"
          name="takenOn"
          type="date"
          defaultValue={today}
          max={today}
          error={e.takenOn}
          required
        />
      </Field>

      {!manual ? (
        <>
          <div>
            <label htmlFor="weights" className="block text-sm font-semibold text-text-primary">
              Weights in grams
            </label>
            <p className="mt-0.5 text-[13px] text-text-muted">
              Type them as you weigh. Spaces, commas or new lines — whatever is quicker.
            </p>
            <textarea
              id="weights"
              name="weights"
              rows={4}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="1400 1410 1395 1405 1398…"
              aria-describedby={e.weights ? 'weights-error' : 'weights-preview'}
              className="mt-1.5 w-full rounded-control border border-border-strong bg-surface-card px-3 py-2.5 font-mono text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
            />
            {e.weights ? (
              <p id="weights-error" className="mt-1 text-[13px] text-status-critical">
                {e.weights}
              </p>
            ) : null}
          </div>

          <div
            id="weights-preview"
            aria-live="polite"
            className="rounded-card border border-border-default bg-surface-sunken px-4 py-3"
          >
            {weights.length < 2 ? (
              <p className="text-[14px] text-text-secondary">
                Weigh at least 2 birds. Fifty or more is the usual advice — uniformity is
                about the spread, so a small sample tells you very little.
              </p>
            ) : (
              <dl className="flex flex-wrap gap-x-8 gap-y-2">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                    Birds
                  </dt>
                  <dd className="tabular text-lg font-bold text-text-primary">{weights.length}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                    Average
                  </dt>
                  <dd className="tabular text-lg font-bold text-text-primary">
                    {round(average, 0)} g
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                    Uniformity
                  </dt>
                  <dd
                    className={`tabular text-lg font-bold ${
                      cv === null
                        ? 'text-text-primary'
                        : cv <= 10
                          ? 'text-status-positive'
                          : cv <= 15
                            ? 'text-status-attention'
                            : 'text-status-critical'
                    }`}
                  >
                    {round(cv, 1)}% CV
                  </dd>
                </div>
              </dl>
            )}
            {rejected.length > 0 ? (
              <p className="mt-2 text-[13px] text-status-critical">
                Cannot read: {rejected.slice(0, 4).join(', ')}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setManual(true)}
            className="text-[14px] font-semibold text-brand-primary underline-offset-2 hover:underline"
          >
            I only have the average
          </button>
        </>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Average weight" htmlFor="averageGrams" required error={e.averageGrams}>
              <TextInput
                id="averageGrams"
                name="averageGrams"
                type="number"
                inputMode="numeric"
                min={10}
                placeholder="1402"
                error={e.averageGrams}
              />
            </Field>
            <Field label="Birds weighed" htmlFor="sampleSize" required error={e.sampleSize}>
              <TextInput
                id="sampleSize"
                name="sampleSize"
                type="number"
                inputMode="numeric"
                min={1}
                placeholder="50"
                error={e.sampleSize}
              />
            </Field>
          </div>
          <p className="rounded-control border-l-2 border-status-attention bg-status-attention-bg px-3 py-2 text-[13.5px] text-[#6B4E12]">
            An average alone cannot give a uniformity figure — that needs the spread, not the
            middle. This sample will show a weight but no CV%.
          </p>
          <button
            type="button"
            onClick={() => setManual(false)}
            className="text-[14px] font-semibold text-brand-primary underline-offset-2 hover:underline"
          >
            Enter individual weights instead
          </button>
        </>
      )}

      <Field label="Notes" htmlFor="notes" error={e.notes}>
        <TextInput id="notes" name="notes" placeholder="Weighed before feeding" error={e.notes} />
      </Field>

      <Submit />
    </form>
  );
}
