/**
 * Tasks — ADRAH Farms
 *
 * What needs doing, who is doing it, and whether it got done. Pure; no database.
 *
 * WHY THIS IS NOT A LEDGER, when population, stock and attendance all are.
 *   Those three ACCUMULATE: a flock's count is the sum of everything that ever
 *   happened to it, so a stored total is a second source of truth waiting to
 *   disagree. A task is different — it has one completion, once, and storing
 *   `completedAt` is storing the event itself rather than a running total
 *   derived from it. The discipline is the same: nothing here stores anything
 *   that could be worked out from something else. `overdue` is computed on read
 *   and never written down.
 *
 * WHAT THIS DELIBERATELY IS NOT
 *   Not a rota engine, not a project tracker, not a workflow with stages. The
 *   specification is explicit that the workforce module is over-specified for
 *   one to three staff, and every field beyond the ones here is a field that is
 *   always blank on a farm where the owner can see everybody from the yard.
 *   In particular there is NO RECURRENCE. The recurring-inspection case is
 *   already answered by the biosecurity checklists built at Milestone 10, and a
 *   second repeat engine beside it would generate a task list nobody reads.
 *
 * NO PHOTO EVIDENCE IN V1 — a decision, not an oversight. Photos mean file
 * storage, and a storage provider is not something to pick quietly. A note, a
 * name and a timestamp answer "was the footbath refilled?" on a farm where
 * somebody can walk over and look. Revisit when there are staff the owner does
 * not see daily.
 */

/**
 * How much it matters.
 *
 * TWO VALUES, NOT FOUR. Every priority scale with four levels collapses in
 * practice to "urgent" and "everything else", because the middle two are
 * indistinguishable to the person choosing and invisible to the person reading.
 * Two values that mean something beat four that do not.
 */
export const TASK_PRIORITIES = ['NORMAL', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  NORMAL: 'When you can',
  URGENT: 'Needs doing today',
};

export interface Task {
  id: string;
  title: string;
  detail: string | null;
  siteId: string;
  siteName: string;
  priority: TaskPriority;
  /** Null means anyone who is free — a real answer on a three-person farm. */
  assigneeId: string | null;
  assigneeName: string | null;
  dueOn: Date | null;
  completedAt: Date | null;
  completedById: string | null;
  completedByName: string | null;
  completionNote: string | null;
  /** True when somebody other than the assignee marked it done. */
  completedBySomebodyElse: boolean;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdByName: string;
  createdAt: Date;
}

export type TaskState = 'OPEN' | 'DONE' | 'CANCELLED';

export function stateOf(task: Task): TaskState {
  if (task.cancelledAt) return 'CANCELLED';
  if (task.completedAt) return 'DONE';
  return 'OPEN';
}

/**
 * Whether a task is past its date.
 *
 * DERIVED ON READ, never stored. A stored `isOverdue` is wrong from the moment
 * midnight passes until something happens to rewrite it, which on a farm system
 * that nobody logs into on Sunday means it is wrong all weekend.
 *
 * A task with NO DATE IS NEVER OVERDUE. "When you can" is a real instruction and
 * turning it into a red flag after an arbitrary number of days would train
 * everybody to ignore red flags.
 */
export function isOverdue(task: Task, asOf: Date = new Date()): boolean {
  if (stateOf(task) !== 'OPEN' || !task.dueOn) return false;
  return startOfDay(task.dueOn) < startOfDay(asOf);
}

/** Whole days past the date. Null when it is not overdue. */
export function daysOverdue(task: Task, asOf: Date = new Date()): number | null {
  if (!isOverdue(task, asOf)) return null;
  return Math.round((startOfDay(asOf) - startOfDay(task.dueOn!)) / 86_400_000);
}

export function isDueToday(task: Task, asOf: Date = new Date()): boolean {
  return (
    stateOf(task) === 'OPEN' &&
    task.dueOn !== null &&
    startOfDay(task.dueOn) === startOfDay(asOf)
  );
}

/**
 * The order a farm actually wants to read them in.
 *
 * FORMULA — overdue first, then urgent, then by date, then undated last.
 *
 * Undated tasks sink to the bottom rather than sorting as "very old" or "very
 * new", both of which they would do under a naive date sort with a null. They
 * are the "when you can" pile and belong beneath everything with a day on it.
 */
export function sortTasks(tasks: Task[], asOf: Date = new Date()): Task[] {
  const rank = (t: Task) => {
    // Finished ones sink below everything open, whatever their date was. They
    // are shown for the rest of the day as a record of what got done, not as
    // work outstanding.
    if (stateOf(t) !== 'OPEN') return 4;
    if (isOverdue(t, asOf)) return 0;
    if (t.priority === 'URGENT') return 1;
    if (t.dueOn) return 2;
    return 3;
  };

  return [...tasks].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (a.dueOn && b.dueOn) return a.dueOn.getTime() - b.dueOn.getTime();
    if (a.dueOn) return -1;
    if (b.dueOn) return 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

/** One sentence a person can act on. */
export function taskSentence(task: Task, asOf: Date = new Date()): string {
  const state = stateOf(task);

  if (state === 'CANCELLED') {
    return `Cancelled${task.cancelReason ? ` — ${task.cancelReason}` : ''}.`;
  }

  if (state === 'DONE') {
    const who = task.completedBySomebodyElse
      ? ` by ${task.completedByName}, who was not the person it was given to`
      : task.completedByName
        ? ` by ${task.completedByName}`
        : '';
    return `Done${who} on ${day(task.completedAt!)}.`;
  }

  const overdue = daysOverdue(task, asOf);
  if (overdue !== null) {
    return `${overdue} day${overdue === 1 ? '' : 's'} past its date.`;
  }
  if (isDueToday(task, asOf)) return 'Due today.';
  if (task.dueOn) return `Due ${day(task.dueOn)}.`;
  return 'No date — when you can.';
}

/** Who it is for, in words. */
export function assigneeSentence(task: Task): string {
  return task.assigneeName
    ? task.assigneeName
    : 'Anyone who is free';
}

/**
 * May this person mark the task done?
 *
 * ANYBODY WHO HOLDS task:edit MAY, including on somebody else's task — and that
 * is deliberate rather than lax. On a farm of three, the person who actually
 * refilled the footbath is often not the person it was written down for, and a
 * system that refuses their entry gets a task list that says the footbath was
 * never refilled.
 *
 * What matters is that the record SAYS SO. `completedBySomebodyElse` is
 * surfaced on every screen that shows a completed task, so "done" and "done by
 * someone other than the person asked" never look the same.
 */
export function completionErrors(task: Task): string[] {
  const state = stateOf(task);
  if (state === 'DONE') return ['That task is already marked done.'];
  if (state === 'CANCELLED') return ['That task was cancelled, so there is nothing to do.'];
  return [];
}

/** Reasons a task cannot be saved. */
export function taskErrors(input: { title: string; dueOn: Date | null }): string[] {
  const errors: string[] = [];
  if (input.title.trim().length < 3) {
    errors.push('Say what needs doing, in a few words at least.');
  }
  return errors;
}

/**
 * A short summary for the top of a list.
 *
 * Counts what is WRONG first. "Four tasks open" is a number; "one overdue" is
 * something somebody does about it this morning.
 */
export function taskSummary(tasks: Task[], asOf: Date = new Date()): string {
  const open = tasks.filter((t) => stateOf(t) === 'OPEN');
  if (open.length === 0) return 'Nothing outstanding.';

  const overdue = open.filter((t) => isOverdue(t, asOf)).length;
  const today = open.filter((t) => isDueToday(t, asOf) || t.priority === 'URGENT').length;

  if (overdue > 0) {
    return `${overdue} past its date, ${open.length} open in total.`;
  }
  if (today > 0) {
    return `${today} for today, ${open.length} open in total.`;
  }
  return `${open.length} open, none of them due yet.`;
}

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}
