'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, FormError, Button } from '@/components/ui/form';
import { submitEnquiry, type EnquiryFormState } from './actions';

/**
 * The enquiry form.
 *
 * THE ONE CLIENT COMPONENT ON THE PUBLIC SITE, and it earns its place: a form
 * that reports its errors without a round trip and disables its own button is
 * the difference between one enquiry and two from the same buyer on a bad
 * connection.
 *
 * IT STILL WORKS WITHOUT THE JAVASCRIPT. React renders a real `<form>` posting
 * to a server action, so a submission from a phone that never finished loading
 * the bundle is a normal POST and the enquiry lands. That is the whole reason
 * the form is HTML with an action rather than a fetch.
 *
 * The confirmation REPLACES the form rather than sitting under it. Somebody who
 * has just sent an enquiry and still sees their filled-in form assumes it did
 * not go, and sends it again.
 */
function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Sending…' : label}
    </Button>
  );
}

export function EnquiryForm({
  kind,
  submitLabel = 'Send enquiry',
}: {
  kind: 'WHOLESALE' | 'GENERAL';
  submitLabel?: string;
}) {
  const [state, formAction] = useActionState(submitEnquiry, {} as EnquiryFormState);
  const e = state.fieldErrors ?? {};

  if (state.ok) {
    return (
      <div
        role="status"
        className="rounded-card border border-brand-primary bg-brand-primary-soft p-6"
      >
        <p className="text-[17px] font-bold text-brand-primary">{state.ok}</p>
        <p className="mt-2 text-[15px] text-text-secondary">
          If it is urgent, ring us rather than waiting for a reply.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="kind" value={kind} />

      {/* THE HONEYPOT. Hidden from people, filled in by crude bots. `aria-hidden`
          and tabIndex keep it away from screen readers and the keyboard, so no
          real person can reach it by any route. See validation/enquiry.ts for
          why this rather than a CAPTCHA. */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <FormError message={state.error} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Your name" htmlFor="name" required error={e.name}>
          <TextInput id="name" name="name" autoComplete="name" error={e.name} />
        </Field>

        <Field
          label="Phone"
          htmlFor="phone"
          required
          error={e.phone}
          hint="However you write it — we will ring it, not parse it."
        >
          <TextInput
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="024 123 4567"
            error={e.phone}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Business name" htmlFor="businessName" error={e.businessName}>
          <TextInput
            id="businessName"
            name="businessName"
            autoComplete="organization"
            error={e.businessName}
          />
        </Field>

        <Field label="Email" htmlFor="email" error={e.email}>
          <TextInput
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            error={e.email}
          />
        </Field>
      </div>

      {kind === 'WHOLESALE' ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Crates a week"
            htmlFor="cratesPerWeek"
            error={e.cratesPerWeek}
            hint="A rough figure is fine — “about 20” is a real answer."
          >
            <TextInput
              id="cratesPerWeek"
              name="cratesPerWeek"
              inputMode="numeric"
              placeholder="about 20"
              error={e.cratesPerWeek}
            />
          </Field>

          <Field label="From when" htmlFor="fromWhen" error={e.fromWhen}>
            <TextInput
              id="fromWhen"
              name="fromWhen"
              placeholder="March, or as soon as you can"
              error={e.fromWhen}
            />
          </Field>
        </div>
      ) : null}

      <Field label="Anything else" htmlFor="message" error={e.message}>
        <textarea
          id="message"
          name="message"
          rows={4}
          placeholder={
            kind === 'WHOLESALE'
              ? 'Where you are, whether you would collect or need delivery, and anything else we should know.'
              : 'How can we help?'
          }
          className="w-full rounded-control border border-border-strong bg-surface-card px-3 py-2.5 text-[16px] text-text-primary outline-none transition-colors focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
        />
      </Field>

      <div className="flex items-center gap-3">
        <Submit label={submitLabel} />
        <span className="text-[13px] text-text-muted">
          Your details go to the farm and nowhere else.
        </span>
      </div>
    </form>
  );
}
