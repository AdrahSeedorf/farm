'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { GHANA_REGIONS } from '@/lib/ghana';
import type { FormState } from './actions';

interface SiteFormProps {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults?: {
    name?: string;
    code?: string;
    region?: string | null;
    district?: string | null;
    town?: string | null;
  };
  submitLabel: string;
  cancelHref: string;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}

export function SiteForm({ action, defaults = {}, submitLabel, cancelHref }: SiteFormProps) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormError message={state.error} />

      <Field label="Farm name" htmlFor="name" required error={e.name}>
        <TextInput
          id="name"
          name="name"
          defaultValue={defaults.name}
          placeholder="Main Farm"
          error={e.name}
          required
        />
      </Field>

      <Field
        label="Code"
        htmlFor="code"
        required
        error={e.code}
        hint="Short reference used in flock IDs and reports. Letters, numbers and hyphens."
      >
        <TextInput
          id="code"
          name="code"
          defaultValue={defaults.code}
          placeholder="FARM1"
          error={e.code}
          required
          autoCapitalize="characters"
        />
      </Field>

      <Field label="Region" htmlFor="region" error={e.region}>
        <Select id="region" name="region" defaultValue={defaults.region ?? ''} error={e.region}>
          <option value="">Select a region</option>
          {GHANA_REGIONS.map((region) => (
            <option key={region} value={region}>
              {region}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="District" htmlFor="district" error={e.district}>
          <TextInput
            id="district"
            name="district"
            defaultValue={defaults.district ?? ''}
            error={e.district}
          />
        </Field>
        <Field label="Nearest town" htmlFor="town" error={e.town}>
          <TextInput id="town" name="town" defaultValue={defaults.town ?? ''} error={e.town} />
        </Field>
      </div>

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
