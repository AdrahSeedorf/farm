'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { causesFor, varianceOf, type CountLine } from '@/lib/stock-take';
import { saveStockTake, type StockTakeFormState } from './actions';

/**
 * The count sheet.
 *
 * ONE ROW PER ITEM, AND EVERY ROW MAY BE LEFT BLANK. A partial count is the
 * normal case — somebody counts the feed shed on Monday and the egg store on
 * Friday — and a form that insisted on a number everywhere would be answered
 * with guesses. A blank box means nobody looked. A zero means somebody looked at
 * an empty shelf. The two are kept apart all the way down to the database.
 *
 * THE EXPECTED FIGURE IS SHOWN, NOT HIDDEN — and this is a real trade-off, made
 * deliberately. Hiding it would produce a more independent count: a person who
 * can see "the records say 420" is more likely to write 420. Showing it means a
 * storekeeper who finds 390 knows immediately that something is wrong and can go
 * and look while they are still standing there, rather than finding out from a
 * report on Friday. For a farm where one person counts and that same person
 * fixes what they find, the second is worth more than the first. A farm that
 * later wants a blind count should get a blind count as its own mode, not get
 * one by accident.
 *
 * EVERY FIELD IS CONTROLLED. React 19 resets uncontrolled inputs when an action
 * returns, and this form is submitted twice whenever a warning comes back — a
 * sheet of thirty counts silently emptying itself on the confirm step would make
 * the whole screen unusable.
 */

export interface SheetRow {
  itemId: string;
  itemName: string;
  category: string;
  displayUnitName: string;
  expectedDisplay: number;
  lastCountedOn: string | null;
}

function Submit({ confirming }: { confirming: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : confirming ? 'Yes, save it as counted' : 'Save the count'}
    </Button>
  );
}

export function CountSheetForm({
  stockLocationId,
  locationName,
  today,
  rows,
}: {
  stockLocationId: string;
  locationName: string;
  today: string;
  rows: SheetRow[];
}) {
  const [state, formAction] = useActionState(saveStockTake, {} as StockTakeFormState);
  const [countedOn, setCountedOn] = useState(today);
  const [notes, setNotes] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [causes, setCauses] = useState<Record<string, string>>({});
  const [lineNotes, setLineNotes] = useState<Record<string, string>>({});

  const e = state.fieldErrors ?? {};
  const confirming = Boolean(state.warnings?.length);

  const set =
    (setter: React.Dispatch<React.SetStateAction<Record<string, string>>>, itemId: string) =>
    (value: string) =>
      setter((prev) => ({ ...prev, [itemId]: value }));

  const countedRows = rows.filter((r) => (counts[r.itemId] ?? '').trim() !== '');

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <FormError message={state.error} />

      {confirming ? (
        <div
          role="alert"
          className="rounded-control border border-status-attention bg-status-attention-bg px-3.5 py-3"
        >
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-status-attention">
            Look at these before saving
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[14px] text-status-attention">
            {state.warnings!.map((w) => (
              <li key={`${w.field}:${w.message}`}>{w.message}</li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-status-attention">
            Nothing has been saved yet. Count it again if you can — and if the number is right,
            save it as it stands. What is on the shelf is what belongs on the record.
          </p>
        </div>
      ) : null}

      <input type="hidden" name="stockLocationId" value={stockLocationId} />
      <input type="hidden" name="acknowledged" value={state.warningToken ?? ''} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Day it was counted" htmlFor="countedOn" required error={e.countedOn}>
          <TextInput
            id="countedOn"
            name="countedOn"
            type="date"
            value={countedOn}
            max={today}
            onChange={(ev) => setCountedOn(ev.target.value)}
            error={e.countedOn}
          />
        </Field>
        <Field
          label="What this count was"
          htmlFor="notes"
          hint="“Monthly count”, “after the power cut”, “handover to Kofi”."
          error={e.notes}
        >
          <TextInput
            id="notes"
            name="notes"
            value={notes}
            onChange={(ev) => setNotes(ev.target.value)}
            error={e.notes}
          />
        </Field>
      </div>

      <div className="rounded-card border border-border-default">
        <div className="border-b border-border-default px-4 py-3">
          <h2 className="text-[15px] font-bold text-text-primary">{locationName}</h2>
          <p className="mt-0.5 text-[13px] text-text-muted">
            Write what you counted. Leave a box empty for anything you did not count — empty is
            not the same as zero, and only what you fill in is saved.
          </p>
        </div>

        <ul className="divide-y divide-border-default">
          {rows.map((row) => {
            const typed = counts[row.itemId] ?? '';
            const line: CountLine = {
              itemId: row.itemId,
              itemName: row.itemName,
              unitKey: '',
              expectedBase: row.expectedDisplay,
              countedBase: typed.trim() === '' ? null : Number(typed),
            };
            const variance = Number.isFinite(line.countedBase ?? NaN) ? varianceOf(line) : null;
            const isOut = variance !== null && variance !== 0;

            return (
              <li key={row.itemId} className="px-4 py-4">
                <input type="hidden" name="itemId" value={row.itemId} />
                <input type="hidden" name={`expected-${row.itemId}`} value={row.expectedDisplay} />

                <div className="flex flex-wrap items-end gap-4">
                  <div className="min-w-[10rem] flex-1">
                    <label
                      htmlFor={`count-${row.itemId}`}
                      className="block text-[15px] font-semibold text-text-primary"
                    >
                      {row.itemName}
                    </label>
                    <p className="mt-0.5 text-[13px] text-text-muted">
                      Records say{' '}
                      <span className="font-semibold tabular-nums text-text-secondary">
                        {row.expectedDisplay}
                      </span>{' '}
                      {row.displayUnitName}
                      {row.lastCountedOn
                        ? ` · last counted ${row.lastCountedOn}`
                        : ' · never counted'}
                    </p>
                  </div>

                  <div className="w-32">
                    <TextInput
                      id={`count-${row.itemId}`}
                      name={`count-${row.itemId}`}
                      inputMode="decimal"
                      placeholder="—"
                      value={typed}
                      onChange={(ev) => set(setCounts, row.itemId)(ev.target.value)}
                      error={e[`count-${row.itemId}`]}
                      className="text-right tabular-nums"
                    />
                  </div>
                </div>

                {e[`count-${row.itemId}`] ? (
                  <p role="alert" className="mt-1 text-[13px] text-status-critical">
                    {e[`count-${row.itemId}`]}
                  </p>
                ) : null}

                {isOut ? (
                  <div className="mt-3 rounded-control border border-border-strong bg-surface-sunken px-3.5 py-3">
                    <p className="text-[13.5px] font-semibold text-text-primary">
                      {Math.abs(variance!)} {row.displayUnitName}{' '}
                      {variance! < 0 ? 'short' : 'more than the records say'}. Why?
                    </p>
                    <div className="mt-2">
                      <Select
                        id={`cause-${row.itemId}`}
                        name={`cause-${row.itemId}`}
                        value={causes[row.itemId] ?? ''}
                        onChange={(ev) => set(setCauses, row.itemId)(ev.target.value)}
                      >
                        <option value="">Choose a reason</option>
                        {causesFor(variance!).map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                      </Select>
                      {causes[row.itemId] ? (
                        <p className="mt-1 text-[13px] text-text-muted">
                          {causesFor(variance!).find((c) => c.key === causes[row.itemId])?.hint}
                        </p>
                      ) : null}
                    </div>
                    <div className="mt-2.5">
                      <TextInput
                        id={`note-${row.itemId}`}
                        name={`note-${row.itemId}`}
                        placeholder="Anything worth remembering about this one"
                        value={lineNotes[row.itemId] ?? ''}
                        onChange={(ev) => set(setLineNotes, row.itemId)(ev.target.value)}
                      />
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Submit confirming={confirming} />
        <p className="text-[13px] text-text-muted">
          {countedRows.length === 0
            ? 'Nothing counted yet.'
            : `${countedRows.length} of ${rows.length} counted. Saving corrects the store to match.`}
        </p>
      </div>
    </form>
  );
}
