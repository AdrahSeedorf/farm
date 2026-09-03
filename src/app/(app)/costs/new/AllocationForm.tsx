'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { COST_CATEGORIES, CATEGORY_LABELS } from '@/lib/flock-costing';
import {
  ALLOCATION_METHODS,
  METHOD_LABELS,
  METHOD_EXPLANATION,
  DEFAULT_METHOD,
  methodNeedsPeriod,
  splitAllocation,
  manualTotal,
  weightLabel,
  type AllocationMethod,
  type AllocationTarget,
} from '@/lib/cost-allocation';
import { formatGHS, parseCedis, pesewas } from '@/lib/money';
import { recordCost, type CostFormState } from '../actions';

export interface Candidate {
  flockId: string;
  label: string;
  code: string;
  siteName: string;
  birdDays: number;
  headcount: number;
  closed: boolean;
}

function Submit({ confirming }: { confirming: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Recording…' : confirming ? 'Yes, record it' : 'Record this cost'}
    </Button>
  );
}

/**
 * Record a cost and watch it divide.
 *
 * The preview below the method buttons is the point of this screen. Switching
 * from bird-days to bird count changes what each flock carries by a visible
 * amount, and seeing that happen is what turns "how should I split this?" from
 * an accounting abstraction into a choice with two numbers attached.
 *
 * The preview is computed with the SAME function the server uses to write the
 * split — `splitAllocation`, imported from the pure module. Two implementations
 * of the same arithmetic would eventually disagree, and the one that disagreed
 * silently would be this one.
 */
export function AllocationForm({
  today,
  dates,
  candidates,
}: {
  today: string;
  dates: { on: string; from: string; to: string };
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(recordCost, {} as CostFormState);
  const e = state.fieldErrors ?? {};
  const warnings = state.warnings ?? [];
  const confirming = warnings.length > 0;

  const [category, setCategory] = useState<(typeof COST_CATEGORIES)[number]>('LABOUR');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState<AllocationMethod>(DEFAULT_METHOD);
  const [selected, setSelected] = useState<string[]>([]);
  const [shares, setShares] = useState<Record<string, string>>({});

  // The dates drive the weights, and the weights come from the server, so a
  // date change is a navigation rather than a piece of local state.
  const goTo = (next: Partial<typeof dates>) => {
    const merged = { ...dates, ...next };
    router.replace(`/costs/new?on=${merged.on}&from=${merged.from}&to=${merged.to}`);
  };

  const totalPesewas = parseCedis(amount) ?? 0;
  const chosen = candidates.filter((c) => selected.includes(c.flockId));

  const targets: AllocationTarget[] = chosen.map((c) => ({
    flockId: c.flockId,
    label: c.label,
    birdDays: c.birdDays,
    headcount: c.headcount,
    manualPesewas: parseCedis(shares[c.flockId] ?? '') ?? 0,
  }));

  const preview = totalPesewas > 0 ? splitAllocation(totalPesewas, method, targets) : [];
  const typed = manualTotal(targets);
  const manualGap = method === 'MANUAL' ? totalPesewas - typed : 0;

  const toggle = (flockId: string) =>
    setSelected((prev) =>
      prev.includes(flockId) ? prev.filter((id) => id !== flockId) : [...prev, flockId],
    );

  return (
    <form action={formAction} className="space-y-7" noValidate>
      <FormError message={state.error} />

      {confirming ? (
        <div
          role="alert"
          className="rounded-control border border-status-attention bg-status-attention-bg px-4 py-3"
        >
          <p className="text-[14px] font-semibold text-status-attention">
            Check this before recording
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[14px] text-status-attention">
            {warnings.map((w) => (
              <li key={`${w.field}:${w.message}`}>{w.message}</li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-status-attention">
            Nothing has been saved yet. Change the entry, or record it as it stands.
          </p>
        </div>
      ) : null}
      <input type="hidden" name="acknowledgedToken" value={state.warningToken ?? ''} />

      <section className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="What was it for" htmlFor="category" required error={e.category}>
            <Select
              id="category"
              name="category"
              value={category}
              onChange={(ev) =>
                setCategory(ev.target.value as (typeof COST_CATEGORIES)[number])
              }
              error={e.category}
            >
              {COST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount (GHS)" htmlFor="amount" required error={e.amount}>
            <TextInput
              id="amount"
              name="amount"
              inputMode="decimal"
              placeholder="480.00"
              value={amount}
              onChange={(ev) => setAmount(ev.target.value)}
              error={e.amount}
              required
            />
          </Field>
        </div>

        <Field
          label="Description"
          htmlFor="description"
          required
          error={e.description}
          hint="What a person reading the flock's costs next year would need to see."
        >
          <TextInput
            id="description"
            name="description"
            placeholder="July wages — Kwame"
            value={description}
            onChange={(ev) => setDescription(ev.target.value)}
            error={e.description}
            required
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Date of the cost" htmlFor="incurredOn" required error={e.incurredOn}>
            <TextInput
              id="incurredOn"
              name="incurredOn"
              type="date"
              max={today}
              value={dates.on}
              onChange={(ev) => ev.target.value && goTo({ on: ev.target.value })}
              error={e.incurredOn}
              required
            />
          </Field>
          <Field
            label="Receipt or invoice number"
            htmlFor="reference"
            error={e.reference}
            hint="So the paper and this record can be matched."
          >
            <TextInput
              id="reference"
              name="reference"
              value={reference}
              onChange={(ev) => setReference(ev.target.value)}
              error={e.reference}
            />
          </Field>
        </div>
      </section>

      <section className="rounded-card border border-border-default bg-surface-card p-5">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-accent">
          How to divide it
        </h2>
        <p className="mt-2 text-[13px] text-text-secondary">
          There is no single right answer, so the system does not pick one. Whichever you
          choose is recorded with the cost, along with each flock&apos;s weight, so the split
          can be checked later.
        </p>

        <input type="hidden" name="method" value={method} />

        <div className="mt-4 space-y-2">
          {ALLOCATION_METHODS.map((m) => (
            <label
              key={m}
              className={`flex cursor-pointer gap-3 rounded-control border p-3.5 transition-colors ${
                method === m
                  ? 'border-brand-primary bg-brand-primary/5'
                  : 'border-border-default hover:bg-surface-sunken'
              }`}
            >
              <input
                type="radio"
                // Grouping only. The value that is SUBMITTED is the hidden
                // input below, for the reason spelled out on `Select` in
                // components/ui/form.tsx: React 19 resets this element's DOM
                // after a server action and does not put the choice back.
                name="methodChoice"
                value={m}
                checked={method === m}
                onChange={() => setMethod(m)}
                className="mt-1 h-4 w-4 accent-[var(--color-brand-primary)]"
              />
              <span>
                <span className="block text-[15px] font-semibold text-text-primary">
                  {METHOD_LABELS[m]}
                </span>
                <span className="mt-0.5 block text-[13px] text-text-secondary">
                  {METHOD_EXPLANATION[m]}
                </span>
              </span>
            </label>
          ))}
        </div>

        {methodNeedsPeriod(method) ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Period from" htmlFor="periodStart" required error={e.periodStart}>
              <TextInput
                id="periodStart"
                name="periodStart"
                type="date"
                max={today}
                value={dates.from}
                onChange={(ev) => ev.target.value && goTo({ from: ev.target.value })}
                error={e.periodStart}
              />
            </Field>
            <Field label="Period to" htmlFor="periodEnd" required error={e.periodEnd}>
              <TextInput
                id="periodEnd"
                name="periodEnd"
                type="date"
                max={today}
                value={dates.to}
                onChange={(ev) => ev.target.value && goTo({ to: ev.target.value })}
                error={e.periodEnd}
              />
            </Field>
          </div>
        ) : (
          <>
            <input type="hidden" name="periodStart" value="" />
            <input type="hidden" name="periodEnd" value="" />
          </>
        )}
      </section>

      <section className="rounded-card border border-border-default bg-surface-card p-5">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-accent">
          Which flocks carry it
        </h2>

        {candidates.length === 0 ? (
          <p className="mt-3 text-[15px] text-text-secondary">
            No flock was on the farm in that period. Check the dates above.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border-default">
            {candidates.map((c) => {
              const line = preview.find((l) => l.flockId === c.flockId);
              const checked = selected.includes(c.flockId);
              return (
                <li key={c.flockId} className="py-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      // Unnamed for the same reason as the radios above; the
                      // ticks that reach the server are the hidden inputs
                      // rendered below the list.
                      value={c.flockId}
                      checked={checked}
                      onChange={() => toggle(c.flockId)}
                      className="mt-1 h-5 w-5 accent-[var(--color-brand-primary)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[15px] font-semibold text-text-primary">
                          {c.label}
                        </span>
                        <span className="text-[13px] text-text-muted">{c.code}</span>
                        {c.closed ? (
                          <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                            closed
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[13px] text-text-secondary">
                        {weightLabel('BIRD_DAYS', c.birdDays)} in the period ·{' '}
                        {c.headcount.toLocaleString('en-GH')} birds on the day
                      </span>
                    </span>
                    {checked && line ? (
                      <span className="shrink-0 text-right">
                        <span className="block text-[15px] font-semibold tabular-nums text-text-primary">
                          {formatGHS(pesewas(line.pesewas))}
                        </span>
                        <span className="block text-[12px] tabular-nums text-text-muted">
                          {line.sharePct === null ? '' : `${line.sharePct.toFixed(1)}%`}
                        </span>
                      </span>
                    ) : null}
                  </label>

                  {checked && method === 'MANUAL' ? (
                    <div className="mt-2 pl-8">
                      <label
                        htmlFor={`share-${c.flockId}`}
                        className="block text-[13px] font-semibold text-text-secondary"
                      >
                        {c.label}&apos;s share (GHS)
                      </label>
                      <input
                        id={`share-${c.flockId}`}
                        name={`share:${c.flockId}`}
                        inputMode="decimal"
                        value={shares[c.flockId] ?? ''}
                        onChange={(ev) =>
                          setShares((prev) => ({ ...prev, [c.flockId]: ev.target.value }))
                        }
                        className="mt-1 min-h-touch w-40 rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {chosen.map((c) => (
          <input key={c.flockId} type="hidden" name="flockId" value={c.flockId} />
        ))}

        {method === 'MANUAL' && selected.length > 0 && totalPesewas > 0 ? (
          <p
            // Matching is the normal case, so it is uncoloured — the design
            // system reserves colour for exceptions. Only the gap is amber.
            className={`mt-4 rounded-control px-3.5 py-2.5 text-[14px] font-medium ${
              manualGap === 0
                ? 'border border-border-default bg-surface-sunken text-text-secondary'
                : 'border border-status-attention bg-status-attention-bg text-status-attention'
            }`}
          >
            {manualGap === 0
              ? `The shares add up to ${formatGHS(pesewas(typed))}. That matches the bill.`
              : `The shares add up to ${formatGHS(pesewas(typed))} — ${
                  manualGap > 0
                    ? `${formatGHS(pesewas(manualGap))} short of`
                    : `${formatGHS(pesewas(-manualGap))} more than`
                } the ${formatGHS(pesewas(totalPesewas))} entered above.`}
          </p>
        ) : null}
      </section>

      <div className="flex items-center gap-3">
        <Submit confirming={confirming} />
        <Link
          href="/costs"
          className="inline-flex min-h-touch items-center rounded-control px-4 text-[15px] font-semibold text-text-secondary hover:text-text-primary"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
