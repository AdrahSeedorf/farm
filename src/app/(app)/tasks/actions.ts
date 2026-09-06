'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import {
  createTask,
  updateTask,
  completeTask,
  reopenTask,
  cancelTask,
  TaskError,
} from '@/lib/task-service';
import { taskSchema, completionSchema, cancelTaskSchema } from '@/lib/validation/task';
import { fieldErrorsFrom } from '@/lib/validation/site';

export interface TaskFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: string;
  /** Kept apart from `ok` — see the note in CompleteForm. */
  note?: string;
}

export async function addTask(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const principal = await requirePermission('task:create');

  const parsed = taskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let id: string;
  try {
    ({ id } = await createTask(principal, parsed.data));
  } catch (error) {
    if (error instanceof TaskError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'task.create',
    entityType: 'Task',
    entityId: id,
    after: { title: parsed.data.title, assigneeId: parsed.data.assigneeId },
  });

  revalidatePath('/tasks');
  redirect('/tasks');
}

export async function editTask(
  taskId: string,
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const principal = await requirePermission('task:create');

  const parsed = taskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  try {
    await updateTask(principal, taskId, parsed.data);
  } catch (error) {
    if (error instanceof TaskError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'task.update',
    entityType: 'Task',
    entityId: taskId,
    after: { title: parsed.data.title, assigneeId: parsed.data.assigneeId },
  });

  revalidatePath('/tasks');
  redirect('/tasks');
}

/**
 * Mark a task done.
 *
 * task:edit, NOT task:create — a worker holds the first and not the second,
 * which is exactly the split this needs: supervisors decide what gets done,
 * everybody records that it was.
 */
export async function markDone(
  taskId: string,
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const principal = await requirePermission('task:edit');

  const parsed = completionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let result: { title: string; bySomebodyElse: boolean };
  try {
    result = await completeTask(principal, taskId, parsed.data.completionNote);
  } catch (error) {
    if (error instanceof TaskError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'task.complete',
    entityType: 'Task',
    entityId: taskId,
    after: { bySomebodyElse: result.bySomebodyElse },
  });

  revalidatePath('/tasks');
  return {
    ok: `${result.title} — done.`,
    // Said plainly rather than hidden. It is not a problem, but it is a fact
    // somebody reading the list next week needs.
    note: result.bySomebodyElse
      ? 'That task was given to somebody else, so the record shows your name against it.'
      : undefined,
  };
}

export async function undoDone(
  taskId: string,
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const principal = await requirePermission('task:edit');

  if (String(formData.get('intent') ?? '') !== 'reopen') {
    return { error: 'That action is not recognised.' };
  }

  let title: string;
  try {
    title = await reopenTask(principal, taskId);
  } catch (error) {
    if (error instanceof TaskError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'task.reopen',
    entityType: 'Task',
    entityId: taskId,
    after: { reopened: true },
  });

  revalidatePath('/tasks');
  return { ok: `${title} is open again.` };
}

export async function killTask(
  taskId: string,
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const principal = await requirePermission('task:create');

  const parsed = cancelTaskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let title: string;
  try {
    title = await cancelTask(principal, taskId, parsed.data.cancelReason);
  } catch (error) {
    if (error instanceof TaskError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'task.cancel',
    entityType: 'Task',
    entityId: taskId,
    after: { reason: parsed.data.cancelReason },
  });

  revalidatePath('/tasks');
  return { ok: `${title} cancelled. It stays on the record with your reason.` };
}
