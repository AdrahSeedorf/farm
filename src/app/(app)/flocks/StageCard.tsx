'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { FormState } from '../sites/actions';

interface Stage {
  id: string;
  name: string;
  sequence: number;
}

interface Props {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  stages: Stage[];
  currentStageId: string | null;
  currentStageName: string | null;
  suggestedStageId: string | null;
  suggestedStageName: string | null;
  overdue: boolean;
  daysOverdue: number;
  ageDays: number;
  today: string;
  canEdit: boolean;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-touch rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse transition-colors hover:bg-brand-primary-hover disabled:opacity-60"
    >
      {pending ? 'Saving…' : label}
    </button>
  );
}

/**
 * Where the flock is in its life, and whether that still matches its age.
 *
 * The prompt is a SUGGESTION with a one-tap accept, never an automatic change.
 * Moving a flock to the next stage is a real husbandry decision — layer feed,
 * a new lighting programme — made by looking at the birds. The system's job is
 * to notice when the record and the calendar have drifted apart and say so.
 */
export function StageCard({
  action,
  stages,
  currentStageId,
  currentStageName,
  suggestedStageId,
  suggestedStageName,
  overdue,
  daysOverdue,
  ageDays,
  today,
  canEdit,
}: Props) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const [open, setOpen] = useState(false);

  if (!canEdit) {
    return (
      <p className="text-[14px] text-text-secondary">
        Stage: {currentStageName ?? 'not set'}
      </p>
    );
  }

  return (
    <section
      className={`rounded-card border p-5 ${
        overdue
          ? 'border-status-attention bg-status-attention-bg'
          : 'border-border-default bg-surface-card'
      }`}
    >
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
        Stage
      </h2>

      {overdue && suggestedStageId ? (
        <>
          <p className="mt-2 text-[15px] font-semibold text-[#6B4E12]">
            Still recorded as {currentStageName} at day {ageDays}.
          </p>
          <p className="mt-1 text-[14px] text-[#6B4E12]">
            A flock this age is normally {suggestedStageName} — {daysOverdue} day
            {daysOverdue === 1 ? '' : 's'} past the usual point. Moving it changes what the
            daily record asks for, and is the moment to review feed and lighting.
          </p>

          <form action={formAction} className="mt-4 flex flex-wrap items-center gap-3">
            <input type="hidden" name="toStageId" value={suggestedStageId} />
            <input type="hidden" name="occurredOn" value={today} />
            <Submit label={`Move to ${suggestedStageName}`} />
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="min-h-touch rounded-control px-3 text-[14px] font-semibold text-[#6B4E12] underline-offset-2 hover:underline"
            >
              Choose a different stage
            </button>
          </form>
        </>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px] text-text-primary">
            <span className="font-semibold">{currentStageName ?? 'Not set'}</span>
            <span className="text-text-secondary"> · day {ageDays}</span>
          </p>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="min-h-[40px] rounded-control border border-border-strong px-3.5 text-[14px] font-semibold text-text-primary hover:bg-surface-sunken"
          >
            {open ? 'Cancel' : 'Change stage'}
          </button>
        </div>
      )}

      {state.error ? (
        <p role="alert" className="mt-3 text-[14px] font-medium text-status-critical">
          {state.error}
        </p>
      ) : null}

      {open ? (
        <form action={formAction} className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div>
            <label htmlFor="toStageId" className="block text-sm font-semibold text-text-primary">
              Move to
            </label>
            <select
              id="toStageId"
              name="toStageId"
              defaultValue={suggestedStageId ?? currentStageId ?? ''}
              className="mt-1.5 min-h-touch w-full rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="occurredOn" className="block text-sm font-semibold text-text-primary">
              From
            </label>
            <input
              id="occurredOn"
              name="occurredOn"
              type="date"
              defaultValue={today}
              max={today}
              className="mt-1.5 min-h-touch w-full rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25"
            />
          </div>
          <Submit label="Save stage" />
        </form>
      ) : null}
    </section>
  );
}
