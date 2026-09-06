import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, siteFilter, canAccessSite } from '@/lib/scope';
import { completionErrors, sortTasks, type Task, type TaskPriority } from '@/lib/tasks';
import type { TaskInput } from '@/lib/validation/task';

/**
 * Task service — ADRAH Farms
 *
 * THE ONLY PLACE A Task IS WRITTEN.
 *
 * Tasks are CANCELLED, never deleted, for the same reason orders are: "we were
 * going to move the pullets and then didn't" is a fact about the week, and a row
 * that vanishes takes the reason with it.
 */

export class TaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskError';
  }
}

const include = {
  site: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  completedBy: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
} as const;

type DbTask = {
  id: string;
  title: string;
  detail: string | null;
  priority: TaskPriority;
  assigneeId: string | null;
  dueOn: Date | null;
  completedAt: Date | null;
  completedById: string | null;
  completionNote: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  site: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  completedBy: { id: string; name: string } | null;
  createdBy: { name: string };
};

function toTask(row: DbTask): Task {
  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    siteId: row.site.id,
    siteName: row.site.name,
    priority: row.priority,
    assigneeId: row.assigneeId,
    assigneeName: row.assignee?.name ?? null,
    dueOn: row.dueOn,
    completedAt: row.completedAt,
    completedById: row.completedById,
    completedByName: row.completedBy?.name ?? null,
    completionNote: row.completionNote,
    // AN UNASSIGNED TASK IS NEVER "SOMEBODY ELSE'S". It was for anyone who was
    // free, so whoever did it is the person it was for.
    completedBySomebodyElse:
      row.assigneeId !== null &&
      row.completedById !== null &&
      row.completedById !== row.assigneeId,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    createdByName: row.createdBy.name,
    createdAt: row.createdAt,
  };
}

/**
 * The tasks a screen shows.
 *
 * WHAT COUNTS AS "NOT FINISHED" INCLUDES WHAT WAS FINISHED TODAY.
 *
 * The obvious filter — completedAt IS NULL — makes a task vanish the instant it
 * is ticked. Two things go wrong with that. The person pressing the button on a
 * phone sees the row disappear and nothing else, which reads as "did that
 * work?"; and somebody who ticked the wrong line has no way back to it without
 * hunting through a finished list. Keeping today's finished work visible costs a
 * few rows and answers both.
 *
 * They sort to the bottom — see `sortTasks` — so the top of the list is still
 * the next thing to do.
 */
export async function listTasks(
  principal: Principal,
  options: { includeFinished?: boolean; mineOnly?: boolean; asOf?: Date } = {},
): Promise<Task[]> {
  const asOf = options.asOf ?? new Date();
  const startOfToday = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
  );

  const rows = await db.task.findMany({
    where: {
      ...orgFilter(principal),
      ...siteFilter(principal),
      ...(options.includeFinished
        ? {}
        : {
            OR: [
              { completedAt: null, cancelledAt: null },
              { completedAt: { gte: startOfToday } },
              { cancelledAt: { gte: startOfToday } },
            ],
          }),
      // "Mine" includes the unassigned pile, because those are as much this
      // person's as anybody's and hiding them makes the list look empty.
      // AND, not a second OR — two `OR` keys in one object would silently
      // overwrite each other and quietly widen the filter above.
      ...(options.mineOnly
        ? { AND: [{ OR: [{ assigneeId: principal.userId }, { assigneeId: null }] }] }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    include,
  });

  return sortTasks(rows.map((r) => toTask(r as unknown as DbTask)), asOf);
}

export async function taskById(principal: Principal, taskId: string): Promise<Task | null> {
  const row = await db.task.findFirst({
    where: { id: taskId, ...orgFilter(principal), ...siteFilter(principal) },
    include,
  });
  return row ? toTask(row as unknown as DbTask) : null;
}

/** Sites and people this person may assign to. */
export async function taskContext(principal: Principal) {
  const [sites, staff] = await Promise.all([
    db.site.findMany({
      where: {
        ...orgFilter(principal),
        isActive: true,
        ...(principal.siteScope.length > 0 ? { id: { in: principal.siteScope } } : {}),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    db.user.findMany({
      where: { ...orgFilter(principal), isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);
  return { sites, staff };
}

export async function createTask(
  principal: Principal,
  input: TaskInput,
): Promise<{ id: string }> {
  if (!canAccessSite(principal, input.siteId)) {
    throw new TaskError('That farm is not one you have access to.');
  }

  if (input.assigneeId) {
    const assignee = await db.user.findFirst({
      where: { id: input.assigneeId, ...orgFilter(principal), isActive: true },
      select: { id: true },
    });
    if (!assignee) {
      throw new TaskError('That person no longer has an active account.');
    }
  }

  const created = await db.task.create({
    data: {
      organisationId: principal.organisationId,
      siteId: input.siteId,
      title: input.title,
      detail: input.detail,
      priority: input.priority,
      assigneeId: input.assigneeId,
      dueOn: input.dueOn,
      createdById: principal.userId,
    },
    select: { id: true },
  });
  return created;
}

export async function updateTask(
  principal: Principal,
  taskId: string,
  input: TaskInput,
): Promise<void> {
  const existing = await taskById(principal, taskId);
  if (!existing) throw new TaskError('That task no longer exists.');
  if (existing.completedAt || existing.cancelledAt) {
    throw new TaskError(
      'That task is finished. Changing what a finished task said it was would rewrite ' +
        'history — raise a new one instead.',
    );
  }
  if (!canAccessSite(principal, input.siteId)) {
    throw new TaskError('That farm is not one you have access to.');
  }

  await db.task.update({
    where: { id: taskId },
    data: {
      siteId: input.siteId,
      title: input.title,
      detail: input.detail,
      priority: input.priority,
      assigneeId: input.assigneeId,
      dueOn: input.dueOn,
    },
  });
}

/**
 * Mark a task done.
 *
 * ANYBODY WITH task:edit MAY, INCLUDING ON SOMEBODY ELSE'S TASK. On a farm of
 * three the person who actually did the job is often not the person it was
 * written down for, and refusing their entry produces a list saying the job was
 * never done. What matters is that the record says who — see
 * `completedBySomebodyElse`.
 */
export async function completeTask(
  principal: Principal,
  taskId: string,
  note: string | null,
): Promise<{ title: string; bySomebodyElse: boolean }> {
  const existing = await taskById(principal, taskId);
  if (!existing) throw new TaskError('That task no longer exists.');

  const problems = completionErrors(existing);
  if (problems.length > 0) throw new TaskError(problems[0]);

  await db.task.update({
    where: { id: taskId },
    data: {
      completedAt: new Date(),
      completedById: principal.userId,
      completionNote: note,
    },
  });

  return {
    title: existing.title,
    bySomebodyElse:
      existing.assigneeId !== null && existing.assigneeId !== principal.userId,
  };
}

/** Undo a completion. Kept because the wrong task gets ticked on a small screen. */
export async function reopenTask(principal: Principal, taskId: string): Promise<string> {
  const existing = await taskById(principal, taskId);
  if (!existing) throw new TaskError('That task no longer exists.');
  if (!existing.completedAt) throw new TaskError('That task is not marked done.');

  await db.task.update({
    where: { id: taskId },
    data: { completedAt: null, completedById: null, completionNote: null },
  });
  return existing.title;
}

export async function cancelTask(
  principal: Principal,
  taskId: string,
  reason: string,
): Promise<string> {
  const existing = await taskById(principal, taskId);
  if (!existing) throw new TaskError('That task no longer exists.');
  if (existing.cancelledAt) throw new TaskError('That task is already cancelled.');

  await db.task.update({
    where: { id: taskId },
    data: { cancelledAt: new Date(), cancelReason: reason },
  });
  return existing.title;
}
