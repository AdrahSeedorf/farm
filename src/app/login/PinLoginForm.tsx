'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { loginWithPin, type PinLoginState } from './actions';

const initial: PinLoginState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-touch w-full rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse transition-colors hover:bg-brand-primary-hover disabled:opacity-60"
    >
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  );
}

/**
 * Phone and PIN, for staff who have no email address.
 *
 * `inputMode="numeric"` on both fields, because this form is filled in on a
 * phone in a poultry house and a full keyboard for six digits is a small daily
 * insult. `autoComplete="one-time-code"` is deliberately NOT used — it is for
 * codes that arrive by SMS, and browsers treat it accordingly.
 */
export function PinLoginForm() {
  const [state, formAction] = useActionState(loginWithPin, initial);

  return (
    <form action={formAction} className="mt-6 space-y-4" noValidate>
      {state.error ? (
        <p
          role="alert"
          className="rounded-control border border-status-critical bg-status-critical-bg px-3 py-2.5 text-sm font-medium text-status-critical"
        >
          {state.error}
        </p>
      ) : null}

      <div>
        <label htmlFor="phone" className="block text-sm font-semibold text-text-primary">
          Phone number
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="024 123 4567"
          required
          aria-invalid={state.fieldErrors?.phone ? true : undefined}
          aria-describedby={state.fieldErrors?.phone ? 'phone-error' : undefined}
          className="mt-1.5 min-h-touch w-full rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
        />
        {state.fieldErrors?.phone ? (
          <p id="phone-error" role="alert" className="mt-1 text-[13px] text-status-critical">
            {state.fieldErrors.phone}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="pin" className="block text-sm font-semibold text-text-primary">
          PIN
        </label>
        <input
          id="pin"
          name="pin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="current-password"
          maxLength={8}
          required
          aria-invalid={state.fieldErrors?.pin ? true : undefined}
          aria-describedby={state.fieldErrors?.pin ? 'pin-error' : undefined}
          className="mt-1.5 min-h-touch w-full rounded-control border border-border-strong bg-surface-card px-3 text-[16px] tracking-[0.4em] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
        />
        {state.fieldErrors?.pin ? (
          <p id="pin-error" role="alert" className="mt-1 text-[13px] text-status-critical">
            {state.fieldErrors.pin}
          </p>
        ) : null}
      </div>

      <SubmitButton />

      <p className="text-[13px] text-text-secondary">
        Forgotten it? Your manager can set a new one. Nobody — including them — can read
        the PIN you are using now.
      </p>
    </form>
  );
}
