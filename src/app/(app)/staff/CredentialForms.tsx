'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, FormError, Button } from '@/components/ui/form';
// Imported from pin.ts, NOT rate-limit.ts. rate-limit.ts reaches the database,
// and pulling it into a client component drags the Postgres driver into the
// browser bundle — which is how this file broke the build the first time.
import {
  PIN_MIN_LENGTH,
  PIN_MAX_LENGTH,
  PIN_ATTEMPTS_PER_DAY,
  pinErrors,
  pinStrengthSentence,
} from '@/lib/pin';
import { setPin, setPassword, toggleStaff, type StaffFormState } from './actions';

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

function Result({ state }: { state: StaffFormState }) {
  return (
    <>
      <FormError message={state.error} />
      {state.ok ? (
        <p
          role="status"
          className="rounded-control border border-border-strong bg-surface-sunken px-3 py-2.5 text-sm text-text-primary"
        >
          {state.ok}
        </p>
      ) : null}
    </>
  );
}

/**
 * Setting a PIN.
 *
 * The rules are shown BEFORE the person types, not after they are refused, and
 * the strength line updates as they go — because a rule discovered by rejection
 * is a rule people work around by choosing 111111 on the second attempt.
 *
 * The same checks run on the server. This is the courtesy copy.
 */
export function SetPinForm({ userId, phone }: { userId: string; phone: string | null }) {
  const [state, formAction] = useActionState(setPin.bind(null, userId), {} as StaffFormState);
  const [pin, setPinValue] = useState('');

  const problems = pin.length > 0 ? pinErrors(pin, phone) : [];
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Result state={state} />

      <Field
        label="New PIN"
        htmlFor="pin"
        required
        error={e.pin}
        hint={`${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits. Not a run, not one digit repeated, and not part of their own number.`}
      >
        <TextInput
          id="pin"
          name="pin"
          type="password"
          inputMode="numeric"
          maxLength={PIN_MAX_LENGTH}
          value={pin}
          onChange={(ev) => setPinValue(ev.target.value)}
          error={e.pin}
          className="tracking-[0.4em]"
        />
      </Field>

      {pin.length > 0 ? (
        problems.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-status-critical">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-text-secondary">
            {pinStrengthSentence(pin.length, PIN_ATTEMPTS_PER_DAY)}
          </p>
        )
      ) : null}

      <Field label="Type it again" htmlFor="confirmPin" required error={e.confirmPin}>
        <TextInput
          id="confirmPin"
          name="confirmPin"
          type="password"
          inputMode="numeric"
          maxLength={PIN_MAX_LENGTH}
          error={e.confirmPin}
          className="tracking-[0.4em]"
        />
      </Field>

      <Submit label="Set PIN" busy="Setting…" />
      <p className="text-[13px] text-text-muted">
        Nothing is stored but a fingerprint of it. If they forget it, you set a new one —
        nobody can look the old one up.
      </p>
    </form>
  );
}

export function SetPasswordForm({ userId }: { userId: string }) {
  const [state, formAction] = useActionState(
    setPassword.bind(null, userId),
    {} as StaffFormState,
  );
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Result state={state} />

      <Field
        label="New password"
        htmlFor="password"
        required
        error={e.password}
        hint="They will be asked to change it the first time they sign in — anything you type is known to two people."
      >
        <TextInput
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          error={e.password}
        />
      </Field>

      <Field label="Type it again" htmlFor="confirmPassword" required error={e.confirmPassword}>
        <TextInput
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          error={e.confirmPassword}
        />
      </Field>

      <Submit label="Set password" busy="Setting…" />
    </form>
  );
}

/**
 * Deactivate or restore.
 *
 * The section is rendered by this component rather than the page, so the
 * confirmation survives the state change — a parent that hid it on success
 * would unmount this and take the message with it. That has been the same bug
 * five times in this codebase.
 */
export function DeactivateForm({
  userId,
  isActive,
  name,
}: {
  userId: string;
  isActive: boolean;
  name: string;
}) {
  const [state, formAction] = useActionState(
    toggleStaff.bind(null, userId),
    {} as StaffFormState,
  );

  return (
    <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
      <h2 className="text-[15px] font-semibold text-text-primary">
        {isActive ? 'Left the farm?' : 'Back again?'}
      </h2>
      <p className="mt-1 max-w-lg text-[14px] text-text-secondary">
        {isActive
          ? `Deactivating stops ${name} signing in. Every record they made stays exactly as it is, with their name on it — accounts are never deleted, because a mortality recorded by nobody is worse than one recorded by somebody who has left.`
          : `Restoring lets ${name} sign in again with the credential they had.`}
      </p>
      <form action={formAction} className="mt-4">
        <input type="hidden" name="intent" value={isActive ? 'deactivate' : 'restore'} />
        <Submit
          label={isActive ? 'Deactivate account' : 'Restore account'}
          busy="Working…"
        />
        {state.error ? (
          <p role="alert" className="mt-2 text-[13px] text-status-critical">
            {state.error}
          </p>
        ) : null}
        {state.ok ? (
          <p role="status" className="mt-2 text-[13px] text-text-secondary">
            {state.ok}
          </p>
        ) : null}
      </form>
    </section>
  );
}
