'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Field, TextInput, FormError, Button } from '@/components/ui/form';
import { reachSentence } from '@/lib/staff';
import type { Role } from '@/lib/rbac';
import type { StaffFormState } from './actions';

/**
 * Creating and editing a staff account.
 *
 * TWO THINGS ARE DELIBERATE AND SHOULD NOT BE UNDONE:
 *
 *   1. THE ROLE LIST OFFERS ONLY WHAT THIS PERSON MAY GRANT. That narrowing is
 *      a courtesy, not a control — the server refuses the rest either way — but
 *      offering a choice that will be refused is a form that lies.
 *
 *   2. "EVERY FARM" IS AN EXPLICIT CHOICE, not an empty list of ticks. The
 *      convention underneath is that no site rows means every site, which makes
 *      the widest possible grant look identical to the narrowest. Somebody
 *      unticking the last farm must not accidentally hand over the lot.
 *
 * Checkboxes carry no name of their own; hidden inputs do. React 19 resets a
 * form's DOM after a server action and does not restore a checkbox from its
 * React value — see ui/form.tsx Select for the same problem in a dropdown.
 */

interface Props {
  action: (prev: StaffFormState, formData: FormData) => Promise<StaffFormState>;
  /** Only the roles the signed-in person may hand out. */
  grantableRoles: Role[];
  sites: { id: string; name: string }[];
  mayGrantEverySite: boolean;
  defaults?: {
    name?: string;
    email?: string | null;
    phone?: string | null;
    roles?: Role[];
    siteIds?: string[];
    everySite?: boolean;
  };
  submitLabel: string;
  cancelHref: string;
}

const ROLE_NOTES: Record<string, string> = {
  owner: 'Everything, including settings and accounts.',
  manager: 'Runs a farm end to end, including costs.',
  supervisor: 'Verifies what their team records. No prices, no margins.',
  worker: 'Records what happens in the houses. Sees no money at all.',
  storekeeper: 'Owns stock movements and ordering.',
  sales: 'Takes orders and payments. Cannot touch flock or health records.',
  driver: 'Sees only what is on the vehicle.',
  vet: 'Health records on the flocks they attend.',
  customer: 'Their own orders and nothing else.',
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}

export function StaffForm({
  action,
  grantableRoles,
  sites,
  mayGrantEverySite,
  defaults = {},
  submitLabel,
  cancelHref,
}: Props) {
  const [state, formAction] = useActionState(action, {} as StaffFormState);
  const [roles, setRoles] = useState<string[]>(defaults.roles ?? []);
  const [everySite, setEverySite] = useState(
    defaults.everySite ?? (mayGrantEverySite && !defaults.siteIds?.length),
  );
  const [siteIds, setSiteIds] = useState<string[]>(defaults.siteIds ?? []);

  const e = state.fieldErrors ?? {};

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <FormError message={state.error} />
      {state.ok ? (
        <p
          role="status"
          className="rounded-control border border-border-strong bg-surface-sunken px-3 py-2.5 text-sm font-medium text-text-primary"
        >
          {state.ok}
        </p>
      ) : null}
      {/* Kept separate from `ok`. A promotion that silently removed somebody's
          way of signing in is exactly the thing that must not read as a tick. */}
      {state.warning ? (
        <p
          role="alert"
          className="rounded-control border border-status-attention bg-status-attention-bg px-3 py-2.5 text-sm font-medium text-status-attention"
        >
          {state.warning}
        </p>
      ) : null}

      <Field label="Name" htmlFor="name" required error={e.name}>
        <TextInput
          id="name"
          name="name"
          defaultValue={defaults.name}
          placeholder="Kwame Boateng"
          error={e.name}
          required
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Phone"
          htmlFor="phone"
          error={e.phone}
          hint="What farm staff sign in with, alongside a PIN."
        >
          <TextInput
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={defaults.phone ?? ''}
            placeholder="024 123 4567"
            error={e.phone}
          />
        </Field>
        <Field
          label="Email"
          htmlFor="email"
          error={e.email}
          hint="For anyone who signs in with a password."
        >
          <TextInput
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            defaultValue={defaults.email ?? ''}
            error={e.email}
          />
        </Field>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-text-primary">
          What they do
          <span aria-hidden className="ml-0.5 text-status-critical">
            *
          </span>
        </legend>
        <p className="mt-0.5 text-[13px] text-text-muted">
          Only the roles your own account can hand out are shown. Roles add up — somebody
          with two holds everything either one gives.
        </p>
        <div className="mt-2.5 space-y-2">
          {grantableRoles.map((role) => {
            const checked = roles.includes(role);
            return (
              <label
                key={role}
                className={`flex min-h-touch items-start gap-3 rounded-control border p-3 ${
                  checked
                    ? 'border-brand-primary bg-brand-primary-soft'
                    : 'border-border-default bg-surface-card'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(roles, setRoles, role)}
                  aria-label={role}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-border-strong accent-brand-primary"
                />
                <span>
                  <span className="block text-[14px] font-semibold capitalize text-text-primary">
                    {role}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-text-secondary">
                    {ROLE_NOTES[role]}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {roles.map((r) => (
          <input key={r} type="hidden" name="roles" value={r} />
        ))}

        {roles.length > 0 ? (
          <p className="mt-3 rounded-control border border-border-default bg-surface-sunken px-3.5 py-2.5 text-[13px] text-text-primary">
            <span className="font-semibold">This account will:</span>{' '}
            {reachSentence(roles as Role[])}
          </p>
        ) : null}
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-text-primary">Which farms</legend>
        <p className="mt-0.5 text-[13px] text-text-muted">
          {mayGrantEverySite
            ? 'Choose “every farm” only if they genuinely need all of them.'
            : 'You can only give access to farms you cover yourself.'}
        </p>

        <div className="mt-2.5 space-y-2">
          {mayGrantEverySite ? (
            <label
              className={`flex min-h-touch items-center gap-3 rounded-control border p-3 ${
                everySite
                  ? 'border-brand-primary bg-brand-primary-soft'
                  : 'border-border-default bg-surface-card'
              }`}
            >
              <input
                type="radio"
                checked={everySite}
                onChange={() => setEverySite(true)}
                aria-label="Every farm"
                className="h-5 w-5 shrink-0 accent-brand-primary"
              />
              <span className="text-[14px] font-medium text-text-primary">
                Every farm, including any added later
              </span>
            </label>
          ) : null}

          <label
            className={`flex min-h-touch items-center gap-3 rounded-control border p-3 ${
              !everySite
                ? 'border-brand-primary bg-brand-primary-soft'
                : 'border-border-default bg-surface-card'
            }`}
          >
            <input
              type="radio"
              checked={!everySite}
              onChange={() => setEverySite(false)}
              aria-label="Only these farms"
              className="h-5 w-5 shrink-0 accent-brand-primary"
            />
            <span className="text-[14px] font-medium text-text-primary">Only these farms</span>
          </label>
        </div>

        {!everySite ? (
          <div className="mt-2 space-y-2 pl-3">
            {sites.map((site) => {
              const checked = siteIds.includes(site.id);
              return (
                <label
                  key={site.id}
                  className="flex min-h-touch items-center gap-3 rounded-control border border-border-default bg-surface-card p-3"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(siteIds, setSiteIds, site.id)}
                    aria-label={site.name}
                    className="h-5 w-5 shrink-0 rounded border-border-strong accent-brand-primary"
                  />
                  <span className="text-[14px] text-text-primary">{site.name}</span>
                </label>
              );
            })}
          </div>
        ) : null}

        {/* The mode is submitted explicitly, so "no farms ticked" can never be
            mistaken for "every farm" on the server. */}
        <input type="hidden" name="siteScopeMode" value={everySite ? 'all' : 'some'} />
        {!everySite
          ? siteIds.map((id) => <input key={id} type="hidden" name="siteIds" value={id} />)
          : null}
      </fieldset>

      <div className="flex items-center gap-3 pt-1">
        <Submit label={submitLabel} />
        <Link
          href={cancelHref}
          className="inline-flex min-h-touch items-center rounded-control px-4 text-[15px] font-semibold text-text-secondary hover:text-text-primary"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
