'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, FormError, Button } from '@/components/ui/form';
import {
  createBiosecurityChecklist,
  addChecklistLine,
  toggleChecklistLine,
  fillWithStarter,
  type BiosecurityFormState,
} from './actions';

function Submit({ label, variant }: { label: string; variant?: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}

/** Start a checklist. */
export function NewChecklistForm() {
  const [state, formAction] = useActionState(
    createBiosecurityChecklist,
    {} as BiosecurityFormState,
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormError message={state.error} />
      <Field label="Name" htmlFor="name" required error={state.fieldErrors?.name}>
        <TextInput
          id="name"
          name="name"
          placeholder="Weekly walk-round"
          value={name}
          onChange={(ev) => setName(ev.target.value)}
          error={state.fieldErrors?.name}
          required
        />
      </Field>
      <Field
        label="What it is for"
        htmlFor="description"
        error={state.fieldErrors?.description}
        hint="A weekly walk, a monthly deep check, or a buyer's own audit list."
      >
        <TextInput
          id="description"
          name="description"
          value={description}
          onChange={(ev) => setDescription(ev.target.value)}
          error={state.fieldErrors?.description}
        />
      </Field>
      <Submit label="Create it" />
    </form>
  );
}

/** Add one line to a checklist. */
export function AddLineForm({ checklistId }: { checklistId: string }) {
  const [state, formAction] = useActionState(
    addChecklistLine.bind(null, checklistId),
    {} as BiosecurityFormState,
  );
  const [label, setLabel] = useState('');
  const [guidance, setGuidance] = useState('');

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormError message={state.error} />
      {state.ok ? (
        <p role="status" className="text-[13px] text-text-secondary">
          {state.ok}
        </p>
      ) : null}
      <Field label="What to look at" htmlFor="label" required error={state.fieldErrors?.label}>
        <TextInput
          id="label"
          name="label"
          placeholder="Footbath charged and clean"
          value={label}
          onChange={(ev) => setLabel(ev.target.value)}
          error={state.fieldErrors?.label}
          required
        />
      </Field>
      <Field
        label="How to check it"
        htmlFor="guidance"
        error={state.fieldErrors?.guidance}
        hint="The person holding the phone at six in the morning is not always the person who wrote the list."
      >
        <TextInput
          id="guidance"
          name="guidance"
          value={guidance}
          onChange={(ev) => setGuidance(ev.target.value)}
          error={state.fieldErrors?.guidance}
        />
      </Field>
      <Submit label="Add the line" variant="secondary" />
    </form>
  );
}

/**
 * Retire or restore a line.
 *
 * The intent is an explicit hidden field rather than inferred from the current
 * state — a double tap on a slow connection would otherwise retire and
 * immediately restore.
 */
export function LineToggle({
  itemId,
  checklistId,
  isActive,
  label,
}: {
  itemId: string;
  checklistId: string;
  isActive: boolean;
  label: string;
}) {
  const [state, formAction] = useActionState(
    toggleChecklistLine.bind(null, itemId, checklistId),
    {} as BiosecurityFormState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="intent" value={isActive ? 'retire' : 'restore'} />
      <button
        type="submit"
        className="min-h-[36px] rounded-control px-2.5 text-[13px] font-semibold text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary"
      >
        {isActive ? 'Retire' : 'Restore'}
        <span className="sr-only"> {label}</span>
      </button>
      {state.error ? (
        <span role="alert" className="text-[12px] text-status-critical">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

/**
 * Fill an empty checklist with the common starting points.
 *
 * The sentence above the button matters more than the button. These are prompts
 * to go and look at something — not a standard, not an audit scheme, and not
 * clinical advice.
 */
export function StarterButton({ checklistId }: { checklistId: string }) {
  const [state, formAction] = useActionState(
    fillWithStarter.bind(null, checklistId),
    {} as BiosecurityFormState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="intent" value="fill" />
      <FormError message={state.error} />
      {state.ok ? (
        <p role="status" className="mb-2 text-[13px] text-text-secondary">
          {state.ok}
        </p>
      ) : null}
      <Submit label="Add the common starting points" variant="secondary" />
    </form>
  );
}
