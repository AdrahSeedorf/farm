import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { listTasks } from '@/lib/task-service';
import {
  stateOf,
  isOverdue,
  taskSentence,
  assigneeSentence,
  taskSummary,
  PRIORITY_LABELS,
} from '@/lib/tasks';
import { CompleteForm, ReopenForm, CancelTaskForm } from './TaskForms';

export const metadata: Metadata = { title: 'Tasks' };

/**
 * What needs doing.
 *
 * OPEN TASKS ONLY, unless asked otherwise. A list that shows a month of ticked
 * jobs alongside today's is a list somebody scrolls past, and the whole value of
 * this screen is that the top of it is the thing to do next.
 */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; mine?: string }>;
}) {
  const { principal, allowed } = await pageGuard('task:view');
  if (!allowed) return <Forbidden area="tasks" roles={principal.roles} />;

  const { done, mine } = await searchParams;
  const includeFinished = done === '1';
  const mineOnly = mine === '1';

  const now = new Date();
  const [tasks, canCreate, canComplete] = await Promise.all([
    listTasks(principal, { includeFinished, mineOnly, asOf: now }),
    currentUserCan('task:create'),
    currentUserCan('task:edit'),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Tasks</h1>
          <p className="mt-1 text-[15px] text-text-secondary">{taskSummary(tasks, now)}</p>
        </div>
        {canCreate ? (
          <Link
            href="/tasks/new"
            className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
          >
            Add a task
          </Link>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap gap-2 text-[14px]">
        <Link
          href={mineOnly ? '/tasks' : '/tasks?mine=1'}
          className="min-h-touch inline-flex items-center rounded-control border border-border-strong px-3 font-semibold text-text-primary hover:bg-surface-sunken"
        >
          {mineOnly ? 'Show everybody’s' : 'Show only mine'}
        </Link>
        <Link
          href={includeFinished ? '/tasks' : '/tasks?done=1'}
          className="min-h-touch inline-flex items-center rounded-control border border-border-strong px-3 font-semibold text-text-primary hover:bg-surface-sunken"
        >
          {includeFinished ? 'Hide finished' : 'Show finished'}
        </Link>
      </div>

      {tasks.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border-strong bg-surface-card p-10 text-center">
          <h2 className="text-lg font-semibold text-text-primary">Nothing on the list</h2>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-text-secondary">
            A task is worth writing down when it would otherwise be remembered by one
            person. Routine daily checks belong in the biosecurity checklist instead.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {tasks.map((task) => {
            const state = stateOf(task);
            const late = isOverdue(task, now);
            return (
              <li key={task.id}>
                <div
                  className={`rounded-card border bg-surface-card p-5 ${
                    late
                      ? 'border-status-attention'
                      : state === 'OPEN'
                        ? 'border-border-default'
                        : 'border-dashed border-border-strong'
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h2
                      className={`text-[16px] font-bold ${
                        state === 'OPEN' ? 'text-text-primary' : 'text-text-secondary'
                      }`}
                    >
                      {task.title}
                    </h2>
                    {task.priority === 'URGENT' && state === 'OPEN' ? (
                      <span className="rounded bg-status-attention-bg px-2 py-0.5 text-[12px] font-semibold text-status-attention">
                        {PRIORITY_LABELS.URGENT}
                      </span>
                    ) : null}
                  </div>

                  {task.detail ? (
                    <p className="mt-1 whitespace-pre-line text-[14px] text-text-secondary">
                      {task.detail}
                    </p>
                  ) : null}

                  <p
                    className={`mt-1.5 text-[14px] ${
                      late ? 'font-medium text-status-attention' : 'text-text-secondary'
                    }`}
                  >
                    {taskSentence(task, now)}
                  </p>
                  {task.completionNote ? (
                    <p className="mt-0.5 text-[13px] text-text-muted">
                      {task.completionNote}
                    </p>
                  ) : null}

                  <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-border-default pt-3 text-[13px]">
                    <div>
                      <dt className="text-text-muted">For</dt>
                      <dd className="font-semibold text-text-primary">
                        {assigneeSentence(task)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">At</dt>
                      <dd className="font-semibold text-text-primary">{task.siteName}</dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">Written by</dt>
                      <dd className="font-semibold text-text-primary">{task.createdByName}</dd>
                    </div>
                  </dl>

                  {/* Each form is rendered whatever state the task is in, and
                      decides for itself whether to show a button. A parent that
                      swapped one for another on success would unmount the form
                      mid-confirmation — see the note in CompleteForm. */}
                  <div className="mt-4 flex flex-wrap items-start gap-3">
                    {canComplete && state !== 'CANCELLED' ? (
                      <CompleteForm
                        taskId={task.id}
                        title={task.title}
                        done={state === 'DONE'}
                      />
                    ) : null}
                    {state === 'DONE' && canComplete ? <ReopenForm taskId={task.id} /> : null}
                    {state === 'OPEN' && canCreate ? (
                      <Link
                        href={`/tasks/${task.id}/edit`}
                        className="min-h-touch inline-flex items-center rounded-control px-3 text-[13px] font-semibold text-text-secondary hover:text-text-primary"
                      >
                        Change it
                      </Link>
                    ) : null}
                    {canCreate && state !== 'DONE' ? (
                      <CancelTaskForm taskId={task.id} cancelled={state === 'CANCELLED'} />
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
