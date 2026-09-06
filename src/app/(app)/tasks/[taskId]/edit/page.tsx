import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { taskById, taskContext } from '@/lib/task-service';
import { stateOf } from '@/lib/tasks';
import { TaskForm } from '../../TaskForms';
import { editTask } from '../../actions';

export const metadata: Metadata = { title: 'Change a task' };

export default async function EditTaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const { principal, allowed } = await pageGuard('task:create');
  if (!allowed) return <Forbidden area="tasks" roles={principal.roles} />;

  const [task, context] = await Promise.all([
    taskById(principal, taskId),
    taskContext(principal),
  ]);
  if (!task) notFound();
  // A finished task is not edited — changing what it said it was would rewrite
  // history. The service refuses it too.
  if (stateOf(task) !== 'OPEN') notFound();

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/tasks" className="text-[14px] font-semibold text-brand-primary">
        ← Tasks
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Change a task</h1>

      <div className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <TaskForm
          action={editTask.bind(null, task.id)}
          sites={context.sites}
          staff={context.staff}
          defaults={{
            title: task.title,
            detail: task.detail,
            siteId: task.siteId,
            priority: task.priority,
            assigneeId: task.assigneeId,
            dueOn: task.dueOn ? task.dueOn.toISOString().slice(0, 10) : '',
          }}
          submitLabel="Save changes"
          cancelHref="/tasks"
          today={new Date().toISOString().slice(0, 10)}
        />
      </div>
    </main>
  );
}
