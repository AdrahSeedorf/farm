'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import {
  INCIDENT_KINDS,
  KIND_LABELS,
  SEVERITIES,
  SEVERITY_LABELS,
  personHurtNotice,
  type IncidentKind,
} from '@/lib/incidents';
import { report, review, close, type IncidentFormState } from './actions';

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

/**
 * Reporting something.
 *
 * THE DESCRIPTION IS FIRST AND IS THE ONLY REQUIRED FIELD, and everything below
 * it is pre-filled. Somebody standing at a broken fence at half five should be
 * able to type one sentence and press one button. Every box they have to think
 * about is a report that does not get written.
 *
 * THERE IS NO SEVERITY HERE. See incidents.ts — asking the reporter to grade it
 * produces either everything minor or everything serious, and neither is
 * information.
 */
export function ReportForm({
  sites,
  now,
}: {
  sites: { id: string; name: string }[];
  now: string;
}) {
  const [state, formAction] = useActionState(report, {} as IncidentFormState);
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [kind, setKind] = useState<string>('');
  const [occurredAt, setOccurredAt] = useState(now);
  const e = state.fieldErrors ?? {};

  const notice = personHurtNotice((kind || null) as IncidentKind | null);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormError message={state.error} />

      <Field label="What happened" htmlFor="what" required error={e.what}>
        <textarea
          id="what"
          name="what"
          rows={4}
          placeholder="A fox got into House A overnight and took two birds. The wire at the back corner is loose."
          className="w-full rounded-control border border-border-strong bg-surface-card px-3 py-2.5 text-[16px] text-text-primary outline-none transition-colors focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
        />
      </Field>
      {e.what ? (
        <p role="alert" className="text-[13px] text-status-critical">
          {e.what}
        </p>
      ) : null}

      <Field
        label="What kind of thing"
        htmlFor="kind"
        error={e.kind}
        hint="Leave it blank if none of them fit — the description is what matters."
      >
        <Select
          id="kind"
          name="kind"
          value={kind}
          onChange={(ev) => setKind(ev.target.value)}
          error={e.kind}
        >
          <option value="">Not sure / none of these</option>
          {INCIDENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>

      {/* NOT A PROCEDURE. This software does not know what first aid this farm
          has or what the law requires of it, and a confident list of steps would
          be worse than nothing because somebody might follow it. */}
      {notice ? (
        <p
          role="alert"
          className="rounded-control border border-status-critical bg-status-critical-bg px-3.5 py-3 text-[14px] font-medium text-status-critical"
        >
          {notice}
        </p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Which farm" htmlFor="siteId" required error={e.siteId}>
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

        <Field
          label="When it happened"
          htmlFor="occurredAt"
          required
          error={e.occurredAt}
          hint="Not when you are writing it down — a hole found at six happened in the night."
        >
          <TextInput
            id="occurredAt"
            name="occurredAt"
            type="datetime-local"
            value={occurredAt}
            onChange={(ev) => setOccurredAt(ev.target.value)}
            error={e.occurredAt}
          />
        </Field>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Submit label="Report it" busy="Reporting…" />
        <Link
          href="/incidents"
          className="inline-flex min-h-touch items-center rounded-control px-4 text-[15px] font-semibold text-text-secondary hover:text-text-primary"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

/**
 * Recording that somebody has looked at it.
 *
 * Rendered for an already-reviewed report as well, so the confirmation survives
 * the state change — a parent that hid it on success would unmount this
 * mid-message. Eighth time in this codebase.
 */
export function ReviewForm({
  incidentId,
  reviewed,
}: {
  incidentId: string;
  reviewed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(
    review.bind(null, incidentId),
    {} as IncidentFormState,
  );
  const [severity, setSeverity] = useState('');

  if (state.ok) {
    return (
      <p role="status" className="text-[13px] font-medium text-text-primary">
        {state.ok}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-touch rounded-control border border-border-strong bg-surface-card px-4 text-[14px] font-semibold text-text-primary hover:bg-surface-sunken"
      >
        {reviewed ? 'Change what you said' : 'I have looked at this'}
      </button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-3">
      <FormError message={state.error} />

      <Field
        label="How bad was it, now you have seen it?"
        htmlFor={`severity-${incidentId}`}
        error={state.fieldErrors?.severity}
        hint="Leave it blank if you cannot say yet — recording that you have seen it is most of the point."
      >
        <Select
          id={`severity-${incidentId}`}
          name="severity"
          value={severity}
          onChange={(ev) => setSeverity(ev.target.value)}
        >
          <option value="">Cannot say yet</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABELS[s]}
            </option>
          ))}
        </Select>
      </Field>

      <TextInput
        name="reviewNote"
        placeholder="Anything you want to add"
        aria-label="Anything you want to add"
      />

      <div className="flex items-center gap-2">
        <Submit label="Save" busy="Saving…" />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-touch rounded-control px-3 text-[13px] font-semibold text-text-secondary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Closing it, with what was done. The outcome is required.
 *
 * Rendered for an already-closed report too, for the same reason as ReviewForm:
 * the parent hiding it the moment the state flips would unmount this component
 * and take its confirmation with it. I guarded ReviewForm against exactly this
 * and left this one exposed, and the browser suite caught it — which is the
 * eighth time this shape has appeared in the codebase.
 */
export function CloseForm({
  incidentId,
  closed,
}: {
  incidentId: string;
  closed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(
    close.bind(null, incidentId),
    {} as IncidentFormState,
  );
  const [outcome, setOutcome] = useState('');

  if (closed && !state.ok) return null;

  if (state.ok) {
    return (
      <p role="status" className="text-[13px] font-medium text-text-primary">
        {state.ok}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-touch rounded-control px-3 text-[13px] font-semibold text-text-secondary hover:text-text-primary"
      >
        Close it
      </button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-3">
      <FormError message={state.error} />
      <Field
        label="What was done about it?"
        htmlFor={`outcome-${incidentId}`}
        required
        error={state.fieldErrors?.outcome}
        hint="A closed report with no outcome is one somebody made disappear."
      >
        <TextInput
          id={`outcome-${incidentId}`}
          name="outcome"
          value={outcome}
          onChange={(ev) => setOutcome(ev.target.value)}
          placeholder="Wire replaced along the back of House A"
          error={state.fieldErrors?.outcome}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Submit label="Close it" busy="Closing…" />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-touch rounded-control px-3 text-[13px] font-semibold text-text-secondary"
        >
          Leave it open
        </button>
      </div>
    </form>
  );
}
