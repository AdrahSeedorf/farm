'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { login, type LoginState } from './actions';

const initial: LoginState = {};

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

export function LoginForm() {
  const [state, formAction] = useActionState(login, initial);

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
        <label htmlFor="email" className="block text-sm font-semibold text-text-primary">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          required
          aria-invalid={state.fieldErrors?.email ? true : undefined}
          aria-describedby={state.fieldErrors?.email ? 'email-error' : undefined}
          className="mt-1.5 min-h-touch w-full rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
        />
        {state.fieldErrors?.email ? (
          <p id="email-error" className="mt-1 text-[13px] text-status-critical">
            {state.fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-semibold text-text-primary">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state.fieldErrors?.password ? true : undefined}
          aria-describedby={state.fieldErrors?.password ? 'password-error' : undefined}
          className="mt-1.5 min-h-touch w-full rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
        />
        {state.fieldErrors?.password ? (
          <p id="password-error" className="mt-1 text-[13px] text-status-critical">
            {state.fieldErrors.password}
          </p>
        ) : null}
      </div>

      <SubmitButton />
    </form>
  );
}
