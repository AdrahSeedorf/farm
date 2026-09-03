'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { FormError, Button } from '@/components/ui/form';
import { ROUTE_LABELS, type Route } from '@/lib/health-programme';
import { previewImport, confirmImport, type HealthFormState } from './actions';

const EXAMPLE = `ageDays,name,type,route,dosePerBird,eggWithdrawalDays,meatWithdrawalDays,notes
7,Newcastle (La Sota),VACCINATION,eye drop,1,,,
14,Gumboro,VACCINATION,drinking water,1,,,`;

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

/**
 * Paste a table, look at what came out, then import it.
 *
 * TWO STEPS DELIBERATELY. A one-step import that rewrote the schedule and then
 * told you what it had done would be discovered afterwards. Here the rows and
 * every warning are on screen before anything is written — and the read is
 * transcription only, so a row it could not understand is reported rather than
 * quietly dropped.
 */
export function ImportPanel({ programmeId }: { programmeId: string }) {
  const [preview, previewAction] = useActionState(previewImport, {} as HealthFormState);
  const [imported, importAction] = useActionState(
    confirmImport.bind(null, programmeId),
    {} as HealthFormState,
  );

  const [table, setTable] = useState('');
  const [mode, setMode] = useState<'append' | 'replace'>('append');

  const rows = preview.preview?.rows ?? [];
  const warnings = preview.preview?.warnings ?? [];

  return (
    <div className="space-y-5">
      <form action={previewAction} className="space-y-4" noValidate>
        <FormError message={preview.error} />

        <div>
          <label htmlFor="table" className="block text-sm font-semibold text-text-primary">
            Paste the table
          </label>
          <p className="mt-0.5 text-[13px] text-text-muted">
            Commas or tabs, straight out of a spreadsheet or an email. An age column in{' '}
            <code className="font-mono">ageDays</code> or <code className="font-mono">week</code>{' '}
            — both are read, and weeks are converted.
          </p>
          <textarea
            id="table"
            name="table"
            value={table}
            onChange={(ev) => setTable(ev.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={EXAMPLE}
            className="mt-1.5 w-full rounded-control border border-border-strong bg-surface-card p-3 font-mono text-[13px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
          />
          {preview.fieldErrors?.table ? (
            <p className="mt-1 text-[13px] text-status-critical">{preview.fieldErrors.table}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-[14px] text-text-primary">
            <input
              type="radio"
              name="mode"
              value="append"
              checked={mode === 'append'}
              onChange={() => setMode('append')}
              className="h-4 w-4 accent-brand-primary"
            />
            Add to what is there
          </label>
          <label className="flex items-center gap-2 text-[14px] text-text-primary">
            <input
              type="radio"
              name="mode"
              value="replace"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
              className="h-4 w-4 accent-brand-primary"
            />
            Replace the schedule
          </label>
        </div>

        <Submit label="Read the table" busy="Reading…" />
      </form>

      {rows.length > 0 ? (
        <div className="rounded-card border border-border-default bg-surface-card p-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-text-muted">
            {rows.length} entr{rows.length === 1 ? 'y' : 'ies'} read — nothing saved yet
          </h3>

          {warnings.length > 0 ? (
            <ul className="mt-3 space-y-1.5 rounded-control border border-status-attention bg-status-attention-bg px-3.5 py-3 text-[13px] text-status-attention">
              {warnings.map((w) => (
                <li key={`${w.field}:${w.message}`}>{w.message}</li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-[13px]">
              <thead>
                <tr className="border-b border-border-default text-[11px] uppercase tracking-[0.1em] text-text-muted">
                  <th className="py-2 pr-3 font-semibold">Day</th>
                  <th className="py-2 pr-3 font-semibold">What</th>
                  <th className="py-2 pr-3 font-semibold">Route</th>
                  <th className="py-2 pr-3 text-right font-semibold">Dose</th>
                  <th className="py-2 text-right font-semibold">Withdrawal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {rows.map((r) => (
                  <tr key={`${r.ageDays}-${r.name}-${r.sortOrder}`}>
                    <td className="tabular py-2 pr-3">{r.ageDays}</td>
                    <td className="py-2 pr-3 text-text-primary">{r.name}</td>
                    <td className="py-2 pr-3 text-text-secondary">
                      {r.route ? ROUTE_LABELS[r.route as Route] : '—'}
                    </td>
                    <td className="tabular py-2 pr-3 text-right">{r.dosePerBird ?? '—'}</td>
                    <td className="tabular py-2 text-right text-text-secondary">
                      {r.eggWithdrawalDays === null && r.meatWithdrawalDays === null
                        ? '—'
                        : `${r.eggWithdrawalDays ?? '—'} eggs / ${r.meatWithdrawalDays ?? '—'} meat`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={importAction} className="mt-4">
            <input type="hidden" name="table" value={table} />
            <input type="hidden" name="mode" value={mode} />
            <FormError message={imported.error} />
            <Submit
              label={mode === 'replace' ? 'Replace the schedule with these' : 'Import these entries'}
              busy="Importing…"
            />
          </form>
        </div>
      ) : null}

      {imported.ok ? (
        <p
          role="status"
          className="rounded-control border border-border-strong bg-surface-sunken px-3.5 py-3 text-[14px] font-medium text-text-primary"
        >
          {imported.ok}
        </p>
      ) : null}
    </div>
  );
}
