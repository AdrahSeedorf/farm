/**
 * Incidents — ADRAH Farms
 *
 * Something went wrong. Pure; no database.
 *
 * THE ONLY THING THAT MATTERS ABOUT THIS MODULE IS THAT PEOPLE USE IT.
 *   An incident report is worth exactly as much as the proportion of incidents
 *   that get reported, and that proportion is set by how much the form asks for
 *   at half past five in the morning from somebody holding a torch. Every field
 *   beyond "what happened" is a field that makes the count go down.
 *
 *   So: ONE REQUIRED FIELD. Where it happened is pre-filled, when it happened
 *   defaults to now, and the category, the severity and the cause are all things
 *   somebody else fills in later — or never.
 *
 * THE REPORTER IS NOT ASKED HOW BAD IT WAS.
 *   Severity is a judgement that needs context the person at the fence usually
 *   does not have: whether one dead bird is a fox or the first sign of disease
 *   depends on what happened in the other house last week. Asking them to grade
 *   it produces either everything marked minor, because nobody wants to sound
 *   dramatic, or everything marked serious, because nobody wants to be blamed
 *   for downplaying it. Neither is information.
 *
 *   The reporter DESCRIBES. Somebody with the wider view GRADES, afterwards, and
 *   the record shows both.
 *
 * INCIDENTS ARE NEVER DELETED. An incident somebody later decided was nothing is
 * still a thing that was noticed and looked at, and that record is the whole
 * reason a farm can tell a pattern from a one-off.
 */

/**
 * What kind of thing it was.
 *
 * A SHORT FIXED LIST WITH AN ESCAPE HATCH, deliberately not configurable. A
 * taxonomy this small is a setting nobody would ever edit, and one that people
 * DO edit stops being comparable across the year it was edited in — which
 * destroys the only thing categories are for, which is spotting that the
 * predator incidents all happen in the same month.
 *
 * Anything that does not fit goes in OTHER with the description carrying it.
 */
export const INCIDENT_KINDS = [
  'PREDATOR',
  'THEFT',
  'EQUIPMENT',
  'POWER',
  'WEATHER',
  'ESCAPE',
  'PERSON_HURT',
  'OTHER',
] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const KIND_LABELS: Record<IncidentKind, string> = {
  PREDATOR: 'Predator or pest',
  THEFT: 'Theft or intruder',
  EQUIPMENT: 'Equipment failure',
  POWER: 'Power or fuel',
  WEATHER: 'Weather or flooding',
  ESCAPE: 'Birds got out',
  PERSON_HURT: 'Somebody was hurt',
  OTHER: 'Something else',
};

/**
 * How bad it turned out to be. SET BY THE REVIEWER, never by the reporter.
 *
 * Three levels, and the middle one is doing real work rather than padding:
 *   MINOR    noted, no action needed beyond the note
 *   NOTABLE  something was done, or should be
 *   SERIOUS  the farm's week changed because of it
 */
export const SEVERITIES = ['MINOR', 'NOTABLE', 'SERIOUS'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABELS: Record<Severity, string> = {
  MINOR: 'Minor — worth knowing, nothing to do',
  NOTABLE: 'Notable — something was done about it',
  SERIOUS: 'Serious — it changed the week',
};

export interface Incident {
  id: string;
  reference: string;
  what: string;
  kind: IncidentKind | null;
  siteId: string;
  siteName: string;
  occurredAt: Date;
  reportedByName: string;
  reportedAt: Date;

  /** Set when somebody with the wider view has looked at it. */
  reviewedAt: Date | null;
  reviewedByName: string | null;
  severity: Severity | null;
  reviewNote: string | null;

  /** Set when it is finished with. */
  closedAt: Date | null;
  closedByName: string | null;
  outcome: string | null;
}

export type IncidentState = 'REPORTED' | 'REVIEWED' | 'CLOSED';

export function stateOf(incident: Incident): IncidentState {
  if (incident.closedAt) return 'CLOSED';
  if (incident.reviewedAt) return 'REVIEWED';
  return 'REPORTED';
}

/**
 * How long an unreviewed report can sit before it is a problem in itself.
 *
 * TWO DAYS. Not because two days is dangerous, but because a report nobody
 * acknowledges teaches the person who wrote it that reporting achieves nothing —
 * and that lesson, once learned, is what stops the next one being written.
 */
export const UNREVIEWED_AFTER_DAYS = 2;

export function daysWaiting(incident: Incident, asOf: Date = new Date()): number {
  return Math.floor((startOfDay(asOf) - startOfDay(incident.reportedAt)) / 86_400_000);
}

export function isUnattended(incident: Incident, asOf: Date = new Date()): boolean {
  return stateOf(incident) === 'REPORTED' && daysWaiting(incident, asOf) >= UNREVIEWED_AFTER_DAYS;
}

/** One sentence about where an incident stands. */
export function incidentSentence(incident: Incident, asOf: Date = new Date()): string {
  const state = stateOf(incident);

  if (state === 'CLOSED') {
    return `Closed by ${incident.closedByName} — ${incident.outcome}`;
  }

  if (state === 'REVIEWED') {
    const graded = incident.severity ? SEVERITY_LABELS[incident.severity] : 'not graded';
    return `Looked at by ${incident.reviewedByName}. ${graded}.`;
  }

  const days = daysWaiting(incident, asOf);
  if (days >= UNREVIEWED_AFTER_DAYS) {
    return `Reported ${days} days ago and nobody has looked at it yet.`;
  }
  return days === 0 ? 'Reported today. Nobody has looked at it yet.' : 'Waiting to be looked at.';
}

/**
 * The reference on the record. INC-2026-0007.
 *
 * Derived, never typed — for the same reason an order number is. Somebody has to
 * be able to say "the one from Tuesday" and find it.
 */
export function incidentReferenceFor(year: number, sequence: number): string {
  return `INC-${year}-${String(sequence).padStart(4, '0')}`;
}

export function sequenceOf(reference: string, year: number): number {
  const match = new RegExp(`^INC-${year}-(\\d{4,})$`).exec(reference);
  return match ? Number(match[1]) : 0;
}

/**
 * Reasons a report cannot be saved.
 *
 * ONE. Anything more and the count of incidents reported goes down, which is the
 * only number this module has.
 */
export function reportErrors(input: { what: string; occurredAt: Date }, asOf = new Date()): string[] {
  const errors: string[] = [];

  if (input.what.trim().length < 5) {
    errors.push('Say what happened, in a few words at least.');
  }

  // A future incident is a typo, not a report. This is the only other refusal,
  // and it exists because a date in 2027 sorts to the top of every list forever.
  if (input.occurredAt.getTime() > asOf.getTime() + 60_000) {
    errors.push('That is in the future. Check the date.');
  }

  return errors;
}

/**
 * What to say to somebody reporting an injury.
 *
 * NOT ADVICE, and deliberately not a procedure. This software does not know what
 * first aid this farm has, who is trained, or what the law requires of it, and a
 * confident-sounding list of steps would be worse than nothing — somebody might
 * follow it. What it can do is get out of the way and say so.
 */
export function personHurtNotice(kind: IncidentKind | null): string | null {
  if (kind !== 'PERSON_HURT') return null;
  return (
    'If somebody is hurt, deal with that first — this record can wait, and nothing here ' +
    'is a substitute for getting them help. Fill it in afterwards.'
  );
}

/**
 * The order a farm reads them in: unattended first, then open, then finished.
 *
 * NOT BY SEVERITY. A serious incident that has been dealt with needs less
 * attention than a minor one nobody has read, and sorting by severity would bury
 * exactly the reports this module exists to surface.
 */
export function sortIncidents(incidents: Incident[], asOf: Date = new Date()): Incident[] {
  const rank = (i: Incident) => {
    if (isUnattended(i, asOf)) return 0;
    if (stateOf(i) === 'REPORTED') return 1;
    if (stateOf(i) === 'REVIEWED') return 2;
    return 3;
  };

  return [...incidents].sort(
    (a, b) => rank(a) - rank(b) || b.occurredAt.getTime() - a.occurredAt.getTime(),
  );
}

/** A line for the top of the list. Leads with what nobody has read. */
export function incidentSummary(incidents: Incident[], asOf: Date = new Date()): string {
  const unread = incidents.filter((i) => stateOf(i) === 'REPORTED');
  const stale = unread.filter((i) => isUnattended(i, asOf));

  if (incidents.length === 0) return 'Nothing reported.';
  if (stale.length > 0) {
    return `${stale.length} report${stale.length === 1 ? '' : 's'} nobody has looked at for ${UNREVIEWED_AFTER_DAYS} days or more.`;
  }
  if (unread.length > 0) {
    return `${unread.length} waiting to be looked at.`;
  }
  return 'Everything reported has been looked at.';
}

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
