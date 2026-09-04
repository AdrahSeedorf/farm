import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, siteIdFilter, canAccessSite } from '@/lib/scope';
import {
  downtimeFor,
  downtimeSentence,
  type ContactDeclaration,
  type Downtime,
} from '@/lib/biosecurity';
import type { VisitorInput } from '@/lib/validation/biosecurity';

/**
 * Visitor log — ADRAH Farms
 *
 * THE ONLY PLACE A VisitorLog IS WRITTEN.
 *
 * A visit is written once, on the way in, and touched exactly once more when
 * somebody signs out. Nothing else is ever edited: what a visitor declared is a
 * record of what they said at the time, and a log that can be quietly revised
 * afterwards is not a log anybody should be asked to rely on.
 */

export class VisitorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisitorError';
  }
}

/** Turn the stored three-state declaration back into the pure module's shape. */
export function declarationFrom(
  kind: string,
  at: Date | null,
): ContactDeclaration {
  if (kind === 'AT' && at) return { kind: 'AT', at };
  if (kind === 'NONE') return { kind: 'NONE' };
  return { kind: 'NOT_DECLARED' };
}

export interface VisitRow {
  id: string;
  siteId: string;
  siteName: string;
  name: string;
  organisation: string | null;
  phone: string | null;
  kind: string;
  purpose: string | null;
  arrivedAt: Date;
  departedAt: Date | null;
  enteredProductionUnit: boolean;
  usedFootbath: boolean | null;
  woreFarmClothing: boolean | null;
  vehicleRegistration: string | null;
  notes: string | null;
  recordedByName: string;
  /**
   * Worked out against the rule that was in force WHEN THEY ARRIVED, not
   * today's. Changing the farm's downtime next year must not rewrite what last
   * year's visits are reported to have complied with.
   */
  downtime: Downtime;
  downtimeHoursAtEntry: number | null;
  downtimeNote: string;
}

function toRow(row: {
  id: string;
  siteId: string;
  site: { name: string };
  name: string;
  organisation: string | null;
  phone: string | null;
  kind: string;
  purpose: string | null;
  arrivedAt: Date;
  departedAt: Date | null;
  declaration: string;
  lastPoultryContactAt: Date | null;
  downtimeHoursAtEntry: number | null;
  enteredProductionUnit: boolean;
  usedFootbath: boolean | null;
  woreFarmClothing: boolean | null;
  vehicleRegistration: string | null;
  notes: string | null;
  recordedBy: { name: string };
}): VisitRow {
  const downtime = downtimeFor(
    declarationFrom(row.declaration, row.lastPoultryContactAt),
    row.arrivedAt,
    row.downtimeHoursAtEntry,
  );

  return {
    id: row.id,
    siteId: row.siteId,
    siteName: row.site.name,
    name: row.name,
    organisation: row.organisation,
    phone: row.phone,
    kind: row.kind,
    purpose: row.purpose,
    arrivedAt: row.arrivedAt,
    departedAt: row.departedAt,
    enteredProductionUnit: row.enteredProductionUnit,
    usedFootbath: row.usedFootbath,
    woreFarmClothing: row.woreFarmClothing,
    vehicleRegistration: row.vehicleRegistration,
    notes: row.notes,
    recordedByName: row.recordedBy.name,
    downtime,
    downtimeHoursAtEntry: row.downtimeHoursAtEntry,
    downtimeNote: downtimeSentence(downtime, row.downtimeHoursAtEntry),
  };
}

const VISIT_SELECT = {
  id: true,
  siteId: true,
  site: { select: { name: true } },
  name: true,
  organisation: true,
  phone: true,
  kind: true,
  purpose: true,
  arrivedAt: true,
  departedAt: true,
  declaration: true,
  lastPoultryContactAt: true,
  downtimeHoursAtEntry: true,
  enteredProductionUnit: true,
  usedFootbath: true,
  woreFarmClothing: true,
  vehicleRegistration: true,
  notes: true,
  recordedBy: { select: { name: true } },
} as const;

/** The farms this principal may log a visitor at, with each one's own rule. */
export async function visitorSites(principal: Principal) {
  return db.site.findMany({
    where: { ...orgFilter(principal), ...siteIdFilter(principal), isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, visitorDowntimeHours: true },
  });
}

/**
 * Anyone still on the farm — arrived and not signed out.
 *
 * Shown at the top of the biosecurity screen, because a list of who is
 * currently on the site is the one thing that has to be right at the moment
 * somebody asks. Sorted oldest first: a visitor who arrived four hours ago and
 * never signed out is the interesting row, not the one who just walked in.
 */
export async function visitorsOnSite(principal: Principal): Promise<VisitRow[]> {
  const rows = await db.visitorLog.findMany({
    where: {
      site: { ...orgFilter(principal), ...siteIdFilter(principal) },
      departedAt: null,
    },
    orderBy: { arrivedAt: 'asc' },
    select: VISIT_SELECT,
  });
  return rows.map(toRow);
}

/** Recent visits, newest first. */
export async function recentVisits(
  principal: Principal,
  limit = 50,
): Promise<VisitRow[]> {
  const rows = await db.visitorLog.findMany({
    where: { site: { ...orgFilter(principal), ...siteIdFilter(principal) } },
    orderBy: { arrivedAt: 'desc' },
    take: limit,
    select: VISIT_SELECT,
  });
  return rows.map(toRow);
}

export async function visitById(
  principal: Principal,
  visitId: string,
): Promise<VisitRow | null> {
  const row = await db.visitorLog.findFirst({
    where: { id: visitId, site: { ...orgFilter(principal), ...siteIdFilter(principal) } },
    select: VISIT_SELECT,
  });
  return row ? toRow(row) : null;
}

/**
 * Write a visit.
 *
 * The site's downtime rule is READ HERE AND COPIED ONTO THE ROW, rather than
 * joined to at display time. See VisitorLog.downtimeHoursAtEntry: a farm that
 * tightens its rule from 48 hours to 72 must not thereby turn a year of
 * compliant visits into non-compliant ones on a screen.
 */
export async function recordVisit(
  principal: Principal,
  input: VisitorInput,
): Promise<{ id: string; downtimeNote: string }> {
  const site = await db.site.findFirst({
    where: { id: input.siteId, ...orgFilter(principal) },
    select: { id: true, visitorDowntimeHours: true },
  });
  if (!site) throw new VisitorError('That farm no longer exists.');
  if (!canAccessSite(principal, site.id)) {
    throw new VisitorError('That is a farm you do not cover.');
  }

  const visit = await db.visitorLog.create({
    data: {
      siteId: site.id,
      name: input.name,
      organisation: input.organisation,
      phone: input.phone,
      kind: input.kind,
      purpose: input.purpose,
      arrivedAt: input.arrivedAt,
      declaration: input.declaration,
      lastPoultryContactAt:
        input.declaration === 'AT' ? input.lastPoultryContactAt : null,
      downtimeHoursAtEntry: site.visitorDowntimeHours,
      vehicleRegistration: input.vehicleRegistration,
      enteredProductionUnit: input.enteredProductionUnit,
      usedFootbath: input.usedFootbath,
      woreFarmClothing: input.woreFarmClothing,
      notes: input.notes,
      recordedById: principal.userId,
    },
    select: { id: true },
  });

  const downtime = downtimeFor(
    declarationFrom(input.declaration, input.lastPoultryContactAt),
    input.arrivedAt,
    site.visitorDowntimeHours,
  );

  return { id: visit.id, downtimeNote: downtimeSentence(downtime, site.visitorDowntimeHours) };
}

/**
 * Sign a visitor out.
 *
 * The one field written after the fact, and only once — signing out twice is a
 * double tap, not a second departure, and the second one would move a time that
 * was already right.
 */
export async function signOutVisit(
  principal: Principal,
  visitId: string,
  departedAt: Date,
): Promise<void> {
  const visit = await db.visitorLog.findFirst({
    where: { id: visitId, site: { ...orgFilter(principal) } },
    select: { id: true, siteId: true, arrivedAt: true, departedAt: true, name: true },
  });
  if (!visit) throw new VisitorError('That visit is no longer on the log.');
  if (!canAccessSite(principal, visit.siteId)) {
    throw new VisitorError('That visit is at a farm you do not cover.');
  }
  if (visit.departedAt) {
    throw new VisitorError(`${visit.name} was already signed out.`);
  }
  if (departedAt < visit.arrivedAt) {
    throw new VisitorError('That is before they arrived.');
  }

  await db.visitorLog.update({
    where: { id: visit.id },
    data: { departedAt },
  });
}

/** Set or clear a farm's downtime rule. */
export async function setDowntime(
  principal: Principal,
  siteId: string,
  hours: number | null,
): Promise<{ before: number | null; name: string }> {
  const site = await db.site.findFirst({
    where: { id: siteId, ...orgFilter(principal) },
    select: { id: true, name: true, visitorDowntimeHours: true },
  });
  if (!site) throw new VisitorError('That farm no longer exists.');
  if (!canAccessSite(principal, site.id)) {
    throw new VisitorError('That is a farm you do not cover.');
  }

  await db.site.update({ where: { id: site.id }, data: { visitorDowntimeHours: hours } });
  return { before: site.visitorDowntimeHours, name: site.name };
}
