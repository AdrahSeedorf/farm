import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { taskContext } from '@/lib/task-service';
import { TaskForm } from '../TaskForms';
import { addTask } from '../actions';

export const metadata: Metadata = { title: 'Add a task' };

export default async function NewTaskPage() {
  const { principal, allowed } = await pageGuard('task:create');
  if (!allowed) return <Forbidden area="tasks" roles={principal.roles} />;

  const context = await taskContext(principal);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/tasks" className="text-[14px] font-semibold text-brand-primary">
        ← Tasks
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Add a task</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        Worth writing down when it would otherwise live in one person’s head. Routine
        daily checks belong in the biosecurity checklist, not here.
      </p>

      <div className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <TaskForm
          action={addTask}
          sites={context.sites}
          staff={context.staff}
          submitLabel="Add it"
          cancelHref="/tasks"
          today={new Date().toISOString().slice(0, 10)}
        />
      </div>
    </main>
  );
}
