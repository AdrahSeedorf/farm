import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, siteFilter, canAccessSite } from '@/lib/scope';
import {
  incidentReferenceFor,
  sequenceOf,
  reportErrors,
  sortIncidents,
  stateOf,
  type Incident,
  type IncidentKind,
  type Severity,
} from '@/lib/incidents';
import type { ReportInput } from '@/lib/validation/incident';

/**
 * Incident service — ADRAH Farms
 *
 * THE ONLY PLACE AN Incident IS WRITTEN.
 *
 * Incidents are never deleted and never edited after the fact. A report is what
 * somebody said at the time; a review is what somebody with the wider view made
 * of it; a closure is what was done. All three are kept side by side rather than
 * one overwriting another, because the interesting question three months later
 * is usually the gap between them.
 */

export class IncidentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncidentError';
  }
}

const include = {
  site: { select: { id: true, name: true } },
  reportedBy: { select: { name: true } },
  reviewedBy: { select: { name: true } },
  closedBy: { select: { name: true } },
} as const;

type DbIncident = {
  id: string;
  reference: string;
  what: string;
  kind: IncidentKind | null;
  occurredAt: Date;
  reportedAt: Date;
  reviewedAt: Date | null;
  severity: Severity | null;
  reviewNote: string | null;
  closedAt: Date | null;
  outcome: string | null;
  site: { id: string; name: string };
  reportedBy: { name: string };
  reviewedBy: { name: string } | null;
  closedBy: { name: string } | null;
};

function toIncident(row: DbIncident): Incident {
  return {
    id: row.id,
    reference: row.reference,
    what: row.what,
    kind: row.kind,
    siteId: row.site.id,
    siteName: row.site.name,
    occurredAt: row.occurredAt,
    reportedByName: row.reportedBy.name,
    reportedAt: row.reportedAt,
    reviewedAt: row.reviewedAt,
    reviewedByName: row.reviewedBy?.name ?? null,
    severity: row.severity,
    reviewNote: row.reviewNote,
    closedAt: row.closedAt,
    closedByName: row.closedBy?.name ?? null,
    outcome: row.outcome,
  };
}

/**
 * The reports a screen shows.
 *
 * "NOT CLOSED" INCLUDES WHAT WAS CLOSED TODAY.
 *
 * The obvious filter — closedAt IS NULL — makes a report vanish the instant it
 * is closed, which reads to the person who just closed it as "did that work?",
 * and leaves anybody who closed the wrong one hunting through an archive to
 * undo it. Today's closures stay, sorted to the bottom by `sortIncidents`, so
 * the top of the list is still what nobody has read.
 */
export async function listIncidents(
  principal: Principal,
  options: { includeClosed?: boolean; asOf?: Date } = {},
): Promise<Incident[]> {
  const asOf = options.asOf ?? new Date();
  const startOfToday = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
  );

  const rows = await db.incident.findMany({
    where: {
      ...orgFilter(principal),
      ...siteFilter(principal),
      ...(options.includeClosed
        ? {}
        : { OR: [{ closedAt: null }, { closedAt: { gte: startOfToday } }] }),
    },
    orderBy: { occurredAt: 'desc' },
    include,
  });
  return sortIncidents(rows.map((r) => toIncident(r as unknown as DbIncident)), asOf);
}

export async function incidentById(
  principal: Principal,
  incidentId: string,
): Promise<Incident | null> {
  const row = await db.incident.findFirst({
    where: { id: incidentId, ...orgFilter(principal), ...siteFilter(principal) },
    include,
  });
  return row ? toIncident(row as unknown as DbIncident) : null;
}

export async function incidentSites(principal: Principal) {
  return db.site.findMany({
    where: {
      ...orgFilter(principal),
      isActive: true,
      ...(principal.siteScope.length > 0 ? { id: { in: principal.siteScope } } : {}),
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}

async function nextReference(organisationId: string, year: number): Promise<string> {
  const latest = await db.incident.findFirst({
    where: { organisationId, reference: { startsWith: `INC-${year}-` } },
    orderBy: { reference: 'desc' },
    select: { reference: true },
  });
  return incidentReferenceFor(year, sequenceOf(latest?.reference ?? '', year) + 1);
}

export async function reportIncident(
  principal: Principal,
  input: ReportInput,
): Promise<{ id: string; reference: string }> {
  if (!canAccessSite(principal, input.siteId)) {
    throw new IncidentError('That farm is not one you have access to.');
  }

  const problems = reportErrors({ what: input.what, occurredAt: input.occurredAt });
  if (problems.length > 0) throw new IncidentError(problems[0]);

  const year = input.occurredAt.getUTCFullYear();

  // Two people reporting the same storm in the same second would collide on the
  // unique index. Retrying is cheaper than a sequence table at this scale.
  for (let attempt = 0; attempt < 5; attempt++) {
    const reference = await nextReference(principal.organisationId, year);
    try {
      const created = await db.incident.create({
        data: {
          organisationId: principal.organisationId,
          siteId: input.siteId,
          reference,
          what: input.what,
          kind: input.kind,
          occurredAt: input.occurredAt,
          reportedById: principal.userId,
        },
        select: { id: true, reference: true },
      });
      return created;
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002' || attempt === 4) throw error;
    }
  }
  throw new IncidentError('Could not allocate a reference. Try again.');
}

/**
 * Record that somebody has looked at it.
 *
 * THE GRADE IS OPTIONAL EVEN HERE. Somebody acknowledging a report they cannot
 * yet grade should be able to say "I have seen this" without inventing a
 * judgement — and that acknowledgement is most of what the reporter needed.
 *
 * Re-reviewing is allowed: a first read that called it minor and a second that
 * called it serious is exactly the kind of change worth being able to make. The
 * audit log carries both.
 */
export async function reviewIncident(
  principal: Principal,
  incidentId: string,
  input: { severity: Severity | null; reviewNote: string | null },
): Promise<{ reference: string }> {
  const existing = await incidentById(principal, incidentId);
  if (!existing) throw new IncidentError('That report no longer exists.');
  if (stateOf(existing) === 'CLOSED') {
    throw new IncidentError('That report is closed. Reopening it is not something this does.');
  }

  await db.incident.update({
    where: { id: incidentId },
    data: {
      reviewedAt: new Date(),
      reviewedById: principal.userId,
      severity: input.severity,
      reviewNote: input.reviewNote,
    },
  });
  return { reference: existing.reference };
}

/**
 * Close it, with what was done.
 *
 * THE OUTCOME IS REQUIRED. A closed incident with no outcome is an incident
 * somebody made disappear, which is the failure mode this whole module is
 * arranged against.
 */
export async function closeIncident(
  principal: Principal,
  incidentId: string,
  outcome: string,
): Promise<{ reference: string }> {
  const existing = await incidentById(principal, incidentId);
  if (!existing) throw new IncidentError('That report no longer exists.');
  if (existing.closedAt) throw new IncidentError('That report is already closed.');

  // CLOSING WITHOUT LOOKING IS NOT ALLOWED. The two acts are separate on purpose:
  // "somebody read this" is what the reporter needed, and letting a closure
  // stand in for it means a report can go from written to finished with nobody
  // having said they saw it.
  if (!existing.reviewedAt) {
    throw new IncidentError(
      'Nobody has recorded looking at this yet. Do that first — it is what the person ' +
        'who reported it is waiting for.',
    );
  }

  await db.incident.update({
    where: { id: incidentId },
    data: { closedAt: new Date(), closedById: principal.userId, outcome },
  });
  return { reference: existing.reference };
}
