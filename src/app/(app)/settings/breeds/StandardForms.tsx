'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { saveBreedStandard, removeBreedStandard, type StandardFormState } from './actions';

/**
 * Pasting a table out of a management guide.
 *
 * A TEXTAREA, NOT A FILE UPLOAD. The figures live in a PDF the farm downloads
 * from the breeder; getting them out means selecting two columns and copying
 * them. Asking for a CSV would mean asking somebody to open a spreadsheet,
 * retype ninety rows and save a file — which is how this ends up never being
 * done at all, and never being done is exactly the state this screen exists to
 * end.
 *
 * ALWAYS CONFIRMED. Everywhere else in this system a confirmation appears only
 * when something looks wrong. Here it appears every time, because the one thing
 * that can be wrong — which kind of table this is — produces numbers that look
 * entirely plausible and that nothing downstream can question.
 */

function Submit({ confirming }: { confirming: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Reading…' : confirming ? 'Yes, save it against this breed' : 'Read the table'}
    </Button>
  );
}

export function StandardTableForm({
  breedId,
  breedName,
}: {
  breedId: string;
  breedName: string;
}) {
  const [state, formAction] = useActionState(saveBreedStandard, {} as StandardFormState);
  const [table, setTable] = useState('');
  const [kind, setKind] = useState('');
  const [sourceNote, setSourceNote] = useState('');

  const e = state.fieldErrors ?? {};
  const confirming = Boolean(state.warnings?.length);

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

      {state.errors?.length ? (
        <div
          role="alert"
          className="rounded-control border border-status-critical bg-status-critical-bg px-3.5 py-3"
        >
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-status-critical">
            That could not be read
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[14px] text-status-critical">
            {state.errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {confirming ? (
        <div
          role="alert"
          className="rounded-control border border-status-attention bg-status-attention-bg px-3.5 py-3"
        >
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-status-attention">
            Check this is the right table
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[14px] text-status-attention">
            {state.warnings!.map((w) => (
              <li key={`${w.field}:${w.message}`}>{w.message}</li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-status-attention">
            Nothing has been saved yet. Every flock of {breedName} will be judged against this.
          </p>
        </div>
      ) : null}

      <input type="hidden" name="breedId" value={breedId} />
      <input type="hidden" name="acknowledged" value={state.warningToken ?? ''} />

      <Field
        label="The table, pasted from the guide"
        htmlFor="table"
        required
        hint="Two columns and their header row. Keep the header — the word “grams” or “henDayPct” in it is how the software knows which table this is."
        error={e.table}
      >
        <textarea
          id="table"
          name="table"
          rows={10}
          spellCheck={false}
          value={table}
          onChange={(ev) => setTable(ev.target.value)}
          placeholder={'week,grams\n1,70\n2,115\n3,170'}
          aria-invalid={e.table ? true : undefined}
          className="w-full rounded-control border border-border-strong bg-surface-card px-3 py-2.5 font-mono text-[14px] text-text-primary outline-none transition-colors focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Which table, if the guide prints both"
          htmlFor="kind"
          hint="Leave this alone unless one table holds a grams column AND a percentage column — then say which one you want."
          error={e.kind}
        >
          <Select
            id="kind"
            name="kind"
            value={kind}
            onChange={(ev) => setKind(ev.target.value)}
            error={e.kind}
          >
            <option value="">Work it out from the header</option>
            <option value="weight">Body weight (grams)</option>
            <option value="lay">Lay curve (hen-day %)</option>
          </Select>
        </Field>

        <Field
          label="Where it came from"
          htmlFor="sourceNote"
          hint="“ISA Brown Commercial Management Guide, 2024 edition, p.18”. A year from now this is what tells you whether it is still current."
          error={e.sourceNote}
        >
          <TextInput
            id="sourceNote"
            name="sourceNote"
            value={sourceNote}
            onChange={(ev) => setSourceNote(ev.target.value)}
            error={e.sourceNote}
          />
        </Field>
      </div>

      {state.preview?.sentence && !confirming && !state.ok ? (
        <p className="text-[13.5px] text-text-secondary">{state.preview.sentence}</p>
      ) : null}

      <Submit confirming={confirming} />
    </form>
  );
}

export function RemoveStandardForm({
  breedId,
  kind,
  label,
}: {
  breedId: string;
  kind: 'weight' | 'lay';
  label: string;
}) {
  const [state, formAction] = useActionState(removeBreedStandard, {} as StandardFormState);

  return (
    <form action={formAction}>
      <input type="hidden" name="breedId" value={breedId} />
      <input type="hidden" name="kind" value={kind} />
      <button
        type="submit"
        className="min-h-touch rounded-control px-3 text-[13px] font-semibold text-status-critical hover:bg-status-critical-bg"
      >
        Remove the {label}
      </button>
      {/*
        NO SUCCESS MESSAGE HERE, and that is not an omission.

        A successful removal makes this whole block disappear — the page re-renders
        with the table gone, so the branch holding this form is replaced by the
        "Not loaded" one. Any confirmation rendered inside it would unmount with
        it and could never be read. The browser suite caught exactly that.

        The empty state that replaces it says the consequence instead, which is
        the more useful message anyway: not "removed", but "the vs standard
        column reads a dash on every row again".

        The error IS kept, because on a failure the form is still here to show it.
      */}
      {state.error ? (
        <p role="alert" className="mt-1 text-[13px] text-status-critical">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
