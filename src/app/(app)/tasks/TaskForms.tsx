'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { TASK_PRIORITIES, PRIORITY_LABELS } from '@/lib/tasks';
import { markDone, undoDone, killTask, type TaskFormState } from './actions';

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

/**
 * Writing a task down.
 *
 * EVERY CONTROL IS CONTROLLED, with the Select primitive emitting a hidden input
 * carrying the React value. React 19 resets a form's DOM after a server action,
 * and an uncontrolled dropdown snaps back to its first option while still
 * LOOKING right — which here would silently reassign a task to whoever happens
 * to sort first. Sixth time in this codebase; see ui/form.tsx.
 */
export function TaskForm({
  action,
  sites,
  staff,
  defaults = {},
  submitLabel,
  cancelHref,
  today,
}: {
  action: (prev: TaskFormState, formData: FormData) => Promise<TaskFormState>;
  sites: { id: string; name: string }[];
  staff: { id: string; name: string }[];
  defaults?: {
    title?: string;
    detail?: string | null;
    siteId?: string;
    priority?: string;
    assigneeId?: string | null;
    dueOn?: string | null;
  };
  submitLabel: string;
  cancelHref: string;
  today: string;
}) {
  const [state, formAction] = useActionState(action, {} as TaskFormState);
  const [siteId, setSiteId] = useState(defaults.siteId ?? sites[0]?.id ?? '');
  const [priority, setPriority] = useState(defaults.priority ?? 'NORMAL');
  const [assigneeId, setAssigneeId] = useState(defaults.assigneeId ?? '');
  const [dueOn, setDueOn] = useState(defaults.dueOn ?? '');
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormError message={state.error} />

      <Field label="What needs doing" htmlFor="title" required error={e.title}>
        <TextInput
          id="title"
          name="title"
          defaultValue={defaults.title}
          placeholder="Refill the footbath at the gate"
          error={e.title}
          required
        />
      </Field>

      <Field
        label="Anything else they should know"
        htmlFor="detail"
        error={e.detail}
        hint="Where the disinfectant is, which house, who to ask."
      >
        <textarea
          id="detail"
          name="detail"
          rows={3}
          defaultValue={defaults.detail ?? ''}
          className="w-full rounded-control border border-border-strong bg-surface-card px-3 py-2.5 text-[16px] text-text-primary outline-none transition-colors focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Who is it for"
          htmlFor="assigneeId"
          error={e.assigneeId}
          hint="Leave it open if anyone free can do it — that is a real answer, not a gap."
        >
          <Select
            id="assigneeId"
            name="assigneeId"
            value={assigneeId}
            onChange={(ev) => setAssigneeId(ev.target.value)}
            error={e.assigneeId}
          >
            <option value="">Anyone who is free</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>

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
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="How much it matters" htmlFor="priority" required>
          <Select
            id="priority"
            name="priority"
            value={priority}
            onChange={(ev) => setPriority(ev.target.value)}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="By when"
          htmlFor="dueOn"
          error={e.dueOn}
          hint="Leave blank for “when you can”. A made-up date turns into a red flag next week."
        >
          <TextInput
            id="dueOn"
            name="dueOn"
            type="date"
            value={dueOn}
            onChange={(ev) => setDueOn(ev.target.value)}
            error={e.dueOn}
          />
        </Field>
      </div>

      <p className="text-[13px] text-text-muted">
        Today is {today}. A date in the past is allowed — a job that should have been done
        yesterday is still worth writing down.
      </p>

      <div className="flex items-center gap-3 pt-1">
        <Submit label={submitLabel} busy="Saving…" />
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

/**
 * Marking one done, from the list.
 *
 * The note is optional and the button works without opening anything — most
 * tasks are ticked with one thumb while walking, and a form that demands a
 * sentence first is a form people stop using.
 */
export function CompleteForm({
  taskId,
  title,
  done,
}: {
  taskId: string;
  title: string;
  /** True once the task is finished. The BUTTON goes; the component does not. */
  done: boolean;
}) {
  const [state, formAction] = useActionState(markDone.bind(null, taskId), {} as TaskFormState);
  const [open, setOpen] = useState(false);

  // RENDERED WHETHER OR NOT THE TASK IS STILL OPEN, and this branch — not the
  // parent — is what hides the button. The parent used to swap this component
  // for ReopenForm the moment the task was ticked, which unmounted it and took
  // the confirmation with it: the click appeared to do nothing at all. Seventh
  // time in this codebase.
  if (done && !state.ok) return null;

  return (
    <form action={formAction} className="space-y-2">
      {state.error ? (
        <p role="alert" className="text-[13px] text-status-critical">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="text-[13px] font-medium text-text-primary">
          {state.ok}
        </p>
      ) : null}
      {/* Kept apart from the tick. "Done" and "done by somebody other than the
          person asked" must not look the same. */}
      {state.note ? (
        <p role="status" className="text-[13px] text-status-attention">
          {state.note}
        </p>
      ) : null}

      {open && !done ? (
        <TextInput
          name="completionNote"
          placeholder="Anything worth saying about it"
          aria-label={`Note about ${title}`}
        />
      ) : null}

      {done ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Submit label="Mark done" busy="Saving…" />
          {open ? null : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="min-h-touch rounded-control px-3 text-[13px] font-semibold text-text-secondary hover:text-text-primary"
            >
              Add a note
            </button>
          )}
        </div>
      )}
    </form>
  );
}

export function ReopenForm({ taskId }: { taskId: string }) {
  const [state, formAction] = useActionState(undoDone.bind(null, taskId), {} as TaskFormState);

  return (
    <form action={formAction}>
      <input type="hidden" name="intent" value="reopen" />
      <button
        type="submit"
        className="min-h-touch rounded-control px-3 text-[13px] font-semibold text-text-secondary hover:text-text-primary"
      >
        Not actually done
      </button>
      {state.ok ? (
        <p role="status" className="mt-1 text-[13px] text-text-secondary">
          {state.ok}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="mt-1 text-[13px] text-status-critical">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Cancelling. A reason is required — it is the only record of why not.
 *
 * Rendered for an already-cancelled task too, for the same reason as
 * CompleteForm: the parent hiding it on success would unmount it mid-message.
 */
export function CancelTaskForm({
  taskId,
  cancelled,
}: {
  taskId: string;
  cancelled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(killTask.bind(null, taskId), {} as TaskFormState);
  const [reason, setReason] = useState('');

  if (cancelled && !state.ok) return null;

  if (state.ok) {
    return (
      <p role="status" className="text-[13px] text-text-secondary">
        {state.ok}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-touch rounded-control px-3 text-[13px] font-semibold text-text-secondary hover:text-status-critical"
      >
        Not doing it
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-2 space-y-2">
      <FormError message={state.error} />
      <TextInput
        name="cancelReason"
        value={reason}
        onChange={(ev) => setReason(ev.target.value)}
        placeholder="Why it is not being done"
        aria-label="Why it is not being done"
        error={state.fieldErrors?.cancelReason}
      />
      {state.fieldErrors?.cancelReason ? (
        <p role="alert" className="text-[13px] text-status-critical">
          {state.fieldErrors.cancelReason}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Submit label="Cancel it" busy="Cancelling…" />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-touch rounded-control px-3 text-[13px] font-semibold text-text-secondary"
        >
          Leave it
        </button>
      </div>
    </form>
  );
}
