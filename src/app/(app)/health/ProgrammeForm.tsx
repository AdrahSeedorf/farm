'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Field, TextInput, FormError, Button } from '@/components/ui/form';
import type { HealthFormState } from './actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}

export function ProgrammeForm({
  action,
  defaults = {},
  submitLabel,
  cancelHref,
}: {
  action: (prev: HealthFormState, formData: FormData) => Promise<HealthFormState>;
  defaults?: {
    name?: string;
    description?: string | null;
    sourceName?: string | null;
    sourceRole?: string | null;
    reviewedOn?: string | null;
  };
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, {} as HealthFormState);
  const e = state.fieldErrors ?? {};

  const [name, setName] = useState(defaults.name ?? '');
  const [description, setDescription] = useState(defaults.description ?? '');
  const [sourceName, setSourceName] = useState(defaults.sourceName ?? '');
  const [sourceRole, setSourceRole] = useState(defaults.sourceRole ?? '');
  const [reviewedOn, setReviewedOn] = useState(defaults.reviewedOn ?? '');

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormError message={state.error} />
      {state.ok ? (
        <p
          role="status"
          className="rounded-control border border-border-strong bg-surface-sunken px-3 py-2.5 text-sm font-medium text-text-primary"
        >
          {state.ok}
        </p>
      ) : null}

      <Field label="Programme name" htmlFor="name" required error={e.name}>
        <TextInput
          id="name"
          name="name"
          value={name}
          onChange={(ev) => setName(ev.target.value)}
          placeholder="Layer programme 2026"
          error={e.name}
          required
        />
      </Field>

      <Field label="Description" htmlFor="description" error={e.description}>
        <TextInput
          id="description"
          name="description"
          value={description}
          onChange={(ev) => setDescription(ev.target.value)}
          placeholder="For ISA Brown pullets, New Edubiase"
          error={e.description}
        />
      </Field>

      <fieldset className="rounded-card border border-border-default bg-surface-sunken p-4">
        <legend className="px-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-accent">
          Where it came from
        </legend>
        <p className="mt-2 text-[13px] text-text-secondary">
          Recorded so a later reader can ask a specific person what they were thinking. A
          programme whose source is unknown is one nobody can question.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Supplied by" htmlFor="sourceName" error={e.sourceName}>
            <TextInput
              id="sourceName"
              name="sourceName"
              value={sourceName}
              onChange={(ev) => setSourceName(ev.target.value)}
              placeholder="Dr Mensah / Akate Farms"
              error={e.sourceName}
            />
          </Field>
          <Field label="Their role" htmlFor="sourceRole" error={e.sourceRole}>
            <TextInput
              id="sourceRole"
              name="sourceRole"
              value={sourceRole}
              onChange={(ev) => setSourceRole(ev.target.value)}
              placeholder="Veterinary Officer, Adansi South"
              error={e.sourceRole}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field
            label="Supplied or last reviewed on"
            htmlFor="reviewedOn"
            error={e.reviewedOn}
            hint="A programme nobody has looked at in three years is worth knowing about."
          >
            <TextInput
              id="reviewedOn"
              name="reviewedOn"
              type="date"
              value={reviewedOn}
              onChange={(ev) => setReviewedOn(ev.target.value)}
              error={e.reviewedOn}
            />
          </Field>
        </div>
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
