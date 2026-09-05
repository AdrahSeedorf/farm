import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, siteIdFilter, canAccessSite } from '@/lib/scope';
import { summariseChecks, checkSentence, type CheckLine, type CheckSummary } from '@/lib/biosecurity';
import {
  checklistItemKeyFrom,
  STARTER_CHECKLIST,
  type CheckInput,
  type CheckResultValue,
  type ChecklistInput,
  type ChecklistItemInput,
} from '@/lib/validation/biosecurity';

/**
 * Biosecurity inspections — ADRAH Farms
 *
 * THE ONLY PLACE A BiosecurityCheck IS WRITTEN.
 *
 * An inspection is a snapshot of what somebody found on a morning. It is never
 * edited afterwards, and the wording of every line is copied onto the answer so
 * that rewording the checklist next year cannot change what a past inspection
 * is reported to have asked.
 */

export class ChecklistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChecklistError';
  }
}

// ---------------------------------------------------------------------------
// CHECKLISTS
// ---------------------------------------------------------------------------

export async function listChecklists(principal: Principal) {
  return db.biosecurityChecklist.findMany({
    where: orgFilter(principal),
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: {
      _count: { select: { checks: true } },
      items: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, key: true, label: true, guidance: true, sortOrder: true },
      },
    },
  });
}

export async function checklistById(principal: Principal, checklistId: string) {
  return db.biosecurityChecklist.findFirst({
    where: { id: checklistId, ...orgFilter(principal) },
    include: {
      items: {
        orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }],
        include: { _count: { select: { lines: true } } },
      },
    },
  });
}

export async function createChecklist(
  principal: Principal,
  input: ChecklistInput,
): Promise<string> {
  const existing = await db.biosecurityChecklist.findFirst({
    where: { ...orgFilter(principal), name: input.name },
    select: { id: true },
  });
  if (existing) throw new ChecklistError('A checklist with that name already exists.');

  const created = await db.biosecurityChecklist.create({
    data: {
      organisationId: principal.organisationId,
      name: input.name,
      description: input.description,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Add a line.
 *
 * The key is DERIVED from the label and never rewritten afterwards, so that
 * renaming a line keeps every past answer attached to it — the same rule the
 * production grades follow.
 */
export async function addChecklistItem(
  principal: Principal,
  checklistId: string,
  input: ChecklistItemInput,
): Promise<void> {
  const checklist = await db.biosecurityChecklist.findFirst({
    where: { id: checklistId, ...orgFilter(principal) },
    select: { id: true },
  });
  if (!checklist) throw new ChecklistError('That checklist no longer exists.');

  const key = checklistItemKeyFrom(input.label);
  if (key === '') throw new ChecklistError('Use at least a few letters or numbers.');

  const clash = await db.biosecurityChecklistItem.findFirst({
    where: { checklistId, key },
    select: { label: true, isActive: true },
  });
  if (clash) {
    throw new ChecklistError(
      clash.isActive
        ? `"${clash.label}" is already on this list.`
        : `"${clash.label}" is on this list but retired. Restore it rather than adding it again.`,
    );
  }

  const last = await db.biosecurityChecklistItem.aggregate({
    where: { checklistId },
    _max: { sortOrder: true },
  });

  await db.biosecurityChecklistItem.create({
    data: {
      checklistId,
      key,
      label: input.label,
      guidance: input.guidance,
      sortOrder: (last._max.sortOrder ?? 0) + 1,
    },
  });
}

/** Retire or restore a line. Never deleted — past inspections point at it. */
export async function setChecklistItemActive(
  principal: Principal,
  itemId: string,
  isActive: boolean,
): Promise<string> {
  const item = await db.biosecurityChecklistItem.findFirst({
    where: { id: itemId, checklist: orgFilter(principal) },
    select: { id: true, label: true },
  });
  if (!item) throw new ChecklistError('That line no longer exists.');

  await db.biosecurityChecklistItem.update({ where: { id: item.id }, data: { isActive } });
  return item.label;
}

/**
 * Fill a new checklist with the common starting points.
 *
 * OFFERED ONCE, on an empty list, and every line editable afterwards. See
 * STARTER_CHECKLIST: these are prompts to go and look at something, not a
 * standard, and the screen says so above the button.
 */
export async function addStarterItems(
  principal: Principal,
  checklistId: string,
): Promise<number> {
  const checklist = await db.biosecurityChecklist.findFirst({
    where: { id: checklistId, ...orgFilter(principal) },
    select: { id: true, _count: { select: { items: true } } },
  });
  if (!checklist) throw new ChecklistError('That checklist no longer exists.');
  if (checklist._count.items > 0) {
    throw new ChecklistError(
      'This checklist already has lines on it. Add what you need one at a time.',
    );
  }

  await db.biosecurityChecklistItem.createMany({
    data: STARTER_CHECKLIST.map((line, index) => ({
      checklistId,
      key: checklistItemKeyFrom(line.label),
      label: line.label,
      guidance: line.guidance,
      sortOrder: index + 1,
    })),
  });

  return STARTER_CHECKLIST.length;
}

// ---------------------------------------------------------------------------
// INSPECTIONS
// ---------------------------------------------------------------------------

export interface CheckRow {
  id: string;
  siteName: string;
  checklistName: string;
  performedOn: Date;
  performedBy: string | null;
  notes: string | null;
  recordedByName: string;
  lines: (CheckLine & { itemId: string })[];
  summary: CheckSummary;
  sentence: string;
}

const CHECK_SELECT = {
  id: true,
  performedOn: true,
  performedBy: true,
  notes: true,
  site: { select: { name: true } },
  checklist: { select: { name: true } },
  recordedBy: { select: { name: true } },
  lines: {
    orderBy: { item: { sortOrder: 'asc' } },
    select: {
      checklistItemId: true,
      result: true,
      note: true,
      labelAtCheck: true,
      item: { select: { key: true } },
    },
  },
} as const;

function toRow(c: {
  id: string;
  performedOn: Date;
  performedBy: string | null;
  notes: string | null;
  site: { name: string };
  checklist: { name: string };
  recordedBy: { name: string };
  lines: {
    checklistItemId: string;
    result: string;
    note: string | null;
    labelAtCheck: string;
    item: { key: string };
  }[];
}): CheckRow {
  const lines = c.lines.map((l) => ({
    itemId: l.checklistItemId,
    key: l.item.key,
    // The wording AS IT STOOD, not today's. See BiosecurityCheckLine.labelAtCheck.
    label: l.labelAtCheck,
    result: l.result as CheckLine['result'],
    note: l.note,
  }));
  const summary = summariseChecks(lines);

  return {
    id: c.id,
    siteName: c.site.name,
    checklistName: c.checklist.name,
    performedOn: c.performedOn,
    performedBy: c.performedBy,
    notes: c.notes,
    recordedByName: c.recordedBy.name,
    lines,
    summary,
    sentence: checkSentence(summary),
  };
}

export async function recentChecks(principal: Principal, limit = 20): Promise<CheckRow[]> {
  const rows = await db.biosecurityCheck.findMany({
    where: { site: { ...orgFilter(principal), ...siteIdFilter(principal) } },
    orderBy: [{ performedOn: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    select: CHECK_SELECT,
  });
  return rows.map(toRow);
}

export async function checkById(
  principal: Principal,
  checkId: string,
): Promise<CheckRow | null> {
  const row = await db.biosecurityCheck.findFirst({
    where: { id: checkId, site: { ...orgFilter(principal), ...siteIdFilter(principal) } },
    select: CHECK_SELECT,
  });
  return row ? toRow(row) : null;
}

/**
 * What failed at the last inspection, and has not been looked at since.
 *
 * READ FROM THE MOST RECENT INSPECTION ONLY, not from every failure ever
 * recorded. A fence mended in March should not still be shouting in September —
 * and the way a farm says it was mended is by inspecting again and marking it
 * a pass.
 */
export async function openFailures(
  principal: Principal,
): Promise<{ checkId: string; performedOn: Date; siteName: string; failures: CheckLine[] }[]> {
  const sites = await db.site.findMany({
    where: { ...orgFilter(principal), ...siteIdFilter(principal), isActive: true },
    select: {
      name: true,
      biosecurityChecks: {
        orderBy: [{ performedOn: 'desc' }, { createdAt: 'desc' }],
        take: 1,
        select: CHECK_SELECT,
      },
    },
  });

  return sites
    .map((s) => {
      const latest = s.biosecurityChecks[0];
      if (!latest) return null;
      const row = toRow(latest);
      if (row.summary.failures.length === 0) return null;
      return {
        checkId: row.id,
        performedOn: row.performedOn,
        siteName: s.name,
        failures: row.summary.failures,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/**
 * Record an inspection.
 *
 * Every line of the checklist gets a row, including the ones nobody answered.
 * A missing row and a NOT_CHECKED row would be indistinguishable when read
 * back, and "we did not look at that" is a finding.
 */
export async function recordCheck(
  principal: Principal,
  input: CheckInput,
  answers: { itemId: string; result: CheckResultValue; note: string | null }[],
): Promise<{ id: string; failed: number }> {
  const site = await db.site.findFirst({
    where: { id: input.siteId, ...orgFilter(principal) },
    select: { id: true },
  });
  if (!site) throw new ChecklistError('That farm no longer exists.');
  if (!canAccessSite(principal, site.id)) {
    throw new ChecklistError('That is a farm you do not cover.');
  }

  const checklist = await db.biosecurityChecklist.findFirst({
    where: { id: input.checklistId, ...orgFilter(principal) },
    select: {
      id: true,
      items: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, label: true },
      },
    },
  });
  if (!checklist) throw new ChecklistError('That checklist no longer exists.');
  if (checklist.items.length === 0) {
    throw new ChecklistError('That checklist has no lines on it yet.');
  }

  const given = new Map(answers.map((a) => [a.itemId, a]));

  return db.$transaction(async (tx) => {
    const check = await tx.biosecurityCheck.create({
      data: {
        siteId: site.id,
        checklistId: checklist.id,
        performedOn: input.performedOn,
        performedBy: input.performedBy,
        notes: input.notes,
        recordedById: principal.userId,
        lines: {
          create: checklist.items.map((item) => {
            const answer = given.get(item.id);
            return {
              checklistItemId: item.id,
              result: answer?.result ?? 'NOT_CHECKED',
              note: answer?.note ?? null,
              // Copied at write time, never joined at read time.
              labelAtCheck: item.label,
            };
          }),
        },
      },
      select: { id: true, lines: { select: { result: true } } },
    });

    return {
      id: check.id,
      failed: check.lines.filter((l) => l.result === 'FAIL').length,
    };
  });
}
