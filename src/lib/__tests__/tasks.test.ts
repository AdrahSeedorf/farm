import { describe, it, expect } from 'vitest';
import {
  TASK_PRIORITIES,
  PRIORITY_LABELS,
  stateOf,
  isOverdue,
  daysOverdue,
  isDueToday,
  sortTasks,
  taskSentence,
  assigneeSentence,
  completionErrors,
  taskErrors,
  taskSummary,
  type Task,
} from '../tasks';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const today = d('2026-09-06');

let seq = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: `t${++seq}`,
  title: 'Refill the footbath',
  detail: null,
  siteId: 'site-a',
  siteName: 'Main Farm',
  priority: 'NORMAL',
  assigneeId: 'kwame',
  assigneeName: 'Kwame',
  dueOn: null,
  completedAt: null,
  completedById: null,
  completedByName: null,
  completionNote: null,
  completedBySomebodyElse: false,
  cancelledAt: null,
  cancelReason: null,
  createdByName: 'Owner',
  createdAt: d('2026-09-01'),
  ...over,
});

describe('what state a task is in', () => {
  it('is open until something happens to it', () => {
    expect(stateOf(task())).toBe('OPEN');
    expect(stateOf(task({ completedAt: d('2026-09-05') }))).toBe('DONE');
    expect(stateOf(task({ cancelledAt: d('2026-09-05') }))).toBe('CANCELLED');
  });

  it('AND CANCELLING BEATS COMPLETING, so a cancelled task never reads as done', () => {
    expect(
      stateOf(task({ completedAt: d('2026-09-05'), cancelledAt: d('2026-09-05') })),
    ).toBe('CANCELLED');
  });
});

describe('overdue, worked out rather than written down', () => {
  it('is past the date, not on it', () => {
    expect(isOverdue(task({ dueOn: d('2026-09-05') }), today)).toBe(true);
    expect(isOverdue(task({ dueOn: d('2026-09-06') }), today)).toBe(false);
    expect(isDueToday(task({ dueOn: d('2026-09-06') }), today)).toBe(true);
  });

  it('counts the days', () => {
    expect(daysOverdue(task({ dueOn: d('2026-09-03') }), today)).toBe(3);
    expect(daysOverdue(task({ dueOn: d('2026-09-06') }), today)).toBeNull();
  });

  it('A TASK WITH NO DATE IS NEVER OVERDUE', () => {
    // "When you can" is a real instruction. Turning it into a red flag after an
    // arbitrary number of days trains everybody to ignore red flags.
    expect(isOverdue(task({ dueOn: null, createdAt: d('2025-01-01') }), today)).toBe(false);
    expect(taskSentence(task(), today)).toBe('No date — when you can.');
  });

  it('and neither is one that is already done or cancelled', () => {
    const late = { dueOn: d('2026-09-01') };
    expect(isOverdue(task({ ...late, completedAt: d('2026-09-02') }), today)).toBe(false);
    expect(isOverdue(task({ ...late, cancelledAt: d('2026-09-02') }), today)).toBe(false);
  });
});

describe('the order a farm reads them in', () => {
  it('OVERDUE FIRST, then urgent, then by date, then the undated pile', () => {
    const undated = task({ title: 'undated' });
    const later = task({ title: 'later', dueOn: d('2026-09-20') });
    const urgent = task({ title: 'urgent', priority: 'URGENT' });
    const late = task({ title: 'late', dueOn: d('2026-09-01') });

    expect(sortTasks([undated, later, urgent, late], today).map((t) => t.title)).toEqual([
      'late',
      'urgent',
      'later',
      'undated',
    ]);
  });

  it('THE UNDATED PILE SINKS, rather than sorting as very old or very new', () => {
    // Under a naive date sort a null does one or the other, and both are wrong:
    // "when you can" belongs beneath everything with a day on it.
    const undated = task({ title: 'undated', createdAt: d('2020-01-01') });
    const soon = task({ title: 'soon', dueOn: d('2026-09-30') });
    expect(sortTasks([undated, soon], today).map((t) => t.title)).toEqual(['soon', 'undated']);
  });

  it('two overdue tasks sort oldest first', () => {
    const a = task({ title: 'a', dueOn: d('2026-09-01') });
    const b = task({ title: 'b', dueOn: d('2026-09-04') });
    expect(sortTasks([b, a], today).map((t) => t.title)).toEqual(['a', 'b']);
  });
});

describe('who it is for', () => {
  it('names them', () => {
    expect(assigneeSentence(task())).toBe('Kwame');
  });

  it('AND “ANYONE WHO IS FREE” IS A REAL ANSWER, not a missing one', () => {
    // On a three-person farm most jobs are not somebody's in particular, and
    // forcing an assignee produces a list where everything is nominally Kwame's.
    expect(assigneeSentence(task({ assigneeId: null, assigneeName: null }))).toBe(
      'Anyone who is free',
    );
  });
});

describe('marking one done', () => {
  it('is allowed while it is open', () => {
    expect(completionErrors(task())).toEqual([]);
  });

  it('and refused once it is not', () => {
    expect(completionErrors(task({ completedAt: today }))[0]).toMatch(/already marked done/i);
    expect(completionErrors(task({ cancelledAt: today }))[0]).toMatch(/was cancelled/i);
  });

  it('SOMEBODY ELSE FINISHING IT IS RECORDED AS SUCH, not hidden', () => {
    // On a farm of three, the person who actually refilled the footbath is often
    // not the person it was written down for. Refusing their entry gets a list
    // that says the footbath was never refilled; hiding the difference gets one
    // nobody can audit.
    const done = task({
      completedAt: d('2026-09-05'),
      completedByName: 'Abena',
      completedBySomebodyElse: true,
    });
    expect(taskSentence(done, today)).toMatch(/by Abena, who was not the person it was given to/);
  });

  it('and the ordinary case reads plainly', () => {
    const done = task({ completedAt: d('2026-09-05'), completedByName: 'Kwame' });
    expect(taskSentence(done, today)).toBe('Done by Kwame on 2026-09-05.');
  });

  it('a cancelled task carries its reason', () => {
    const killed = task({ cancelledAt: d('2026-09-05'), cancelReason: 'House emptied early' });
    expect(taskSentence(killed, today)).toBe('Cancelled — House emptied early.');
  });
});

describe('what will not be saved', () => {
  it('accepts a sound task', () => {
    expect(taskErrors({ title: 'Refill the footbath', dueOn: null })).toEqual([]);
  });

  it('refuses a title too short to act on', () => {
    expect(taskErrors({ title: 'x', dueOn: null })[0]).toMatch(/what needs doing/i);
  });
});

describe('the line at the top of the list', () => {
  it('LEADS WITH WHAT IS WRONG, not with a count', () => {
    // "Four tasks open" is a number. "One past its date" is something somebody
    // does about it this morning.
    const tasks = [task({ dueOn: d('2026-09-01') }), task(), task()];
    expect(taskSummary(tasks, today)).toBe('1 past its date, 3 open in total.');
  });

  it('then with what is for today', () => {
    expect(taskSummary([task({ priority: 'URGENT' }), task()], today)).toBe(
      '1 for today, 2 open in total.',
    );
  });

  it('and says so plainly when there is nothing', () => {
    expect(taskSummary([], today)).toBe('Nothing outstanding.');
    expect(taskSummary([task({ completedAt: today })], today)).toBe('Nothing outstanding.');
  });
});

describe('what this module deliberately does not have', () => {
  it('TWO PRIORITIES, NOT FOUR', () => {
    // Every four-level scale collapses to "urgent" and "everything else",
    // because the middle two are indistinguishable to whoever is choosing.
    expect(TASK_PRIORITIES).toEqual(['NORMAL', 'URGENT']);
    expect(PRIORITY_LABELS.NORMAL).toBe('When you can');
    expect(PRIORITY_LABELS.URGENT).toBe('Needs doing today');
  });

  it('NO RECURRENCE, and no photo evidence', () => {
    // Recurring inspection is already answered by the biosecurity checklists.
    // Photos mean file storage, which is not a decision to make quietly.
    const keys = Object.keys(task()).join(' ').toLowerCase();
    expect(keys).not.toMatch(/repeat|recur|cron|schedule|interval/);
    expect(keys).not.toMatch(/photo|image|attachment|file|upload/);
  });
});
