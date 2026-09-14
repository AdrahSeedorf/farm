'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Field, TextInput, Select, Button } from '@/components/ui/form';
import { PERIODS, PERIOD_LABELS, type PeriodKey } from '@/lib/period-report';

/**
 * Choosing the period.
 *
 * IT PUTS THE CHOICE IN THE URL. A report somebody is looking at is a report
 * they will want to send to a bank manager or an accountant, and a link that
 * reopens the same figures is the cheapest possible way to do that. It also
 * means the whole report stays a server component — the only JavaScript on the
 * page is this picker.
 */
export function PeriodPicker({ current }: { current: PeriodKey }) {
  const router = useRouter();
  const params = useSearchParams();
  const [key, setKey] = useState<PeriodKey>(current);
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');

  function go(nextKey: PeriodKey, nextFrom = from, nextTo = to) {
    const next = new URLSearchParams();
    next.set('period', nextKey);
    if (nextKey === 'CUSTOM') {
      if (nextFrom) next.set('from', nextFrom);
      if (nextTo) next.set('to', nextTo);
    }
    router.push(`/reports?${next.toString()}`);
  }

  return (
    <div className="space-y-4">
      <Field label="Which period" htmlFor="period">
        <Select
          id="period"
          value={key}
          onChange={(ev) => {
            const next = ev.target.value as PeriodKey;
            setKey(next);
            // A custom range needs its dates before it means anything; the rest
            // are complete the moment they are chosen.
            if (next !== 'CUSTOM') go(next);
          }}
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABELS[p]}
            </option>
          ))}
        </Select>
      </Field>

      {key === 'CUSTOM' ? (
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="From" htmlFor="from">
            <TextInput
              id="from"
              type="date"
              value={from}
              onChange={(ev) => setFrom(ev.target.value)}
            />
          </Field>
          <Field label="To" htmlFor="to">
            <TextInput id="to" type="date" value={to} onChange={(ev) => setTo(ev.target.value)} />
          </Field>
          <div className="pb-1">
            <Button type="button" onClick={() => go('CUSTOM')} disabled={!from || !to}>
              Show it
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
