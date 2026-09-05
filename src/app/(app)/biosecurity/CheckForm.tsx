'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { CHECK_RESULTS, RESULT_LABELS } from '@/lib/validation/biosecurity';
import { summariseChecks, checkSentence } from '@/lib/biosecurity';
import { logCheck, type BiosecurityFormState } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Record the inspection'}
    </Button>
  );
}

export interface CheckFormChecklist {
  id: string;
  name: string;
  items: { id: string; label: string; guidance: string | null }[];
}

/**
 * Walk a checklist.
 *
 * EVERY LINE STARTS AS "NOT CHECKED", not as a pass. A form that opened with
 * everything ticked would be a form people submit without looking, and the
 * whole point of writing an inspection down is to distinguish what was looked
 * at from what was not.
 *
 * The running tally underneath updates as the answers go in, so somebody can
 * see at the bottom of a long list that four lines are still blank.
 */
export function CheckForm({
  checklists,
  sites,
  today,
}: {
  checklists: CheckFormChecklist[];
  sites: { id: string; name: string }[];
  today: string;
}) {
  const [state, formAction] = useActionState(logCheck, {} as BiosecurityFormState);
  const e = state.fieldErrors ?? {};

  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [checklistId, setChecklistId] = useState(checklists[0]?.id ?? '');
  const [performedOn, setPerformedOn] = useState(today);
  const [performedBy, setPerformedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [lineNotes, setLineNotes] = useState<Record<string, string>>({});

  const checklist = checklists.find((c) => c.id === checklistId) ?? null;
  const items = checklist?.items ?? [];

  const summary = summariseChecks(
    items.map((i) => ({
      key: i.id,
      label: i.label,
      result: (answers[i.id] ?? 'NOT_CHECKED') as 'PASS',
    })),
  );

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <FormError message={state.error} />

      <div className="grid gap-5 sm:grid-cols-2">
        {sites.length > 1 ? (
          <Field label="Farm" htmlFor="siteId" required error={e.siteId}>
            <Select
              id="siteId"
              name="siteId"
              value={siteId}
              onChange={(ev) => setSiteId(ev.target.value)}
              error={e.siteId}
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="siteId" value={siteId} />
        )}

        <Field label="Checklist" htmlFor="checklistId" required error={e.checklistId}>
          <Select
            id="checklistId"
            name="checklistId"
            value={checklistId}
            onChange={(ev) => {
              setChecklistId(ev.target.value);
              setAnswers({});
              setLineNotes({});
            }}
            error={e.checklistId}
          >
            {checklists.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Walked on" htmlFor="performedOn" required error={e.performedOn}>
          <TextInput
            id="performedOn"
            name="performedOn"
            type="date"
            max={today}
            value={performedOn}
            onChange={(ev) => setPerformedOn(ev.target.value)}
            error={e.performedOn}
            required
          />
        </Field>
        <Field
          label="Walked by"
          htmlFor="performedBy"
          error={e.performedBy}
          hint="An inspector, a buyer's auditor, or whoever did it."
        >
          <TextInput
            id="performedBy"
            name="performedBy"
            value={performedBy}
            onChange={(ev) => setPerformedBy(ev.target.value)}
            error={e.performedBy}
          />
        </Field>
      </div>

      <section className="rounded-card border border-border-default bg-surface-card p-5">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-accent">
          {checklist?.name ?? 'The checklist'}
        </h2>
        {items.length === 0 ? (
          <p className="mt-3 text-[15px] text-text-secondary">
            This checklist has no lines on it yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border-default">
            {items.map((item) => {
              const answer = answers[item.id] ?? 'NOT_CHECKED';
              return (
                <li key={item.id} className="py-3.5">
                  <p className="text-[15px] font-medium text-text-primary">{item.label}</p>
                  {item.guidance ? (
                    <p className="mt-0.5 text-[13px] text-text-secondary">{item.guidance}</p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {CHECK_RESULTS.map((r) => (
                      <label
                        key={r}
                        className={`cursor-pointer rounded-control border px-3 py-2 text-[13px] font-semibold transition-colors ${
                          answer === r
                            ? r === 'FAIL'
                              ? 'border-status-critical bg-status-critical-bg text-status-critical'
                              : 'border-brand-primary bg-brand-primary/5 text-brand-primary'
                            : 'border-border-default bg-surface-card text-text-secondary hover:bg-surface-sunken'
                        }`}
                      >
                        <input
                          type="radio"
                          // Grouping only; the value submitted is the hidden
                          // input below. See components/ui/form.tsx.
                          name={`choice:${item.id}`}
                          value={r}
                          checked={answer === r}
                          onChange={() =>
                            setAnswers((prev) => ({ ...prev, [item.id]: r }))
                          }
                          className="sr-only"
                        />
                        {RESULT_LABELS[r]}
                      </label>
                    ))}
                  </div>
                  <input type="hidden" name={`result:${item.id}`} value={answer} />

                  {answer === 'FAIL' ? (
                    <div className="mt-2">
                      <label
                        htmlFor={`note-${item.id}`}
                        className="block text-[13px] font-semibold text-text-primary"
                      >
                        What did you find?
                      </label>
                      <input
                        id={`note-${item.id}`}
                        name={`note:${item.id}`}
                        value={lineNotes[item.id] ?? ''}
                        onChange={(ev) =>
                          setLineNotes((prev) => ({ ...prev, [item.id]: ev.target.value }))
                        }
                        placeholder="Droppings behind the feed store"
                        className="mt-1 min-h-touch w-full rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
                      />
                    </div>
                  ) : (
                    <input type="hidden" name={`note:${item.id}`} value="" />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {items.length > 0 ? (
          <p
            className={`mt-4 rounded-control px-3.5 py-2.5 text-[14px] ${
              summary.failed > 0
                ? 'border border-status-critical bg-status-critical-bg font-medium text-status-critical'
                : 'border border-border-default bg-surface-sunken text-text-secondary'
            }`}
          >
            {checkSentence(summary)}
          </p>
        ) : null}
      </section>

      <Field label="Notes" htmlFor="notes" error={e.notes}>
        <TextInput
          id="notes"
          name="notes"
          value={notes}
          onChange={(ev) => setNotes(ev.target.value)}
          error={e.notes}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Submit />
        <Link
          href="/biosecurity/checks"
          className="inline-flex min-h-touch items-center rounded-control px-4 text-[15px] font-semibold text-text-secondary hover:text-text-primary"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
