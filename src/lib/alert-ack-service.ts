import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { permissionsFor } from '@/lib/rbac';
import { orgFilter } from '@/lib/scope';
import {
  ALERT_RULES,
  RULE_CATALOGUE,
  parkErrors,
  type AlertRule,
} from '@/lib/alerts';

/**
 * Parking an alert — ADRAH Farms
 *
 * THE ONLY PLACE AN AlertAcknowledgement IS WRITTEN.
 *
 * This is the one part of the alert system with a table behind it, and the
 * distinction is the point: the alert is a fact about the farm, recomputed every
 * time and never stored; the acknowledgement is a decision a person made, and
 * decisions are kept.
 *
 * PARKING IS FARM-WIDE, NOT PER-PERSON.
 *   One person parking "feed short — ordered, arriving Thursday" silences it for
 *   everybody, because on a three-person farm a shared list that different
 *   people see differently is a list nobody can discuss over the phone. That is
 *   only defensible because of what comes with it: the note is required, the
 *   name is on it, the expiry is bounded, anybody can lift it, and the parked
 *   items stay visible and countable rather than disappearing.
 */

export class AlertAckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlertAckError';
  }
}

export interface Park {
  id: string;
  alertKey: string;
  rule: AlertRule;
  note: string;
  until: Date;
  byName: string;
  acknowledgedAt: Date;
}

function isRule(value: string): value is AlertRule {
  return (ALERT_RULES as readonly string[]).includes(value);
}

/**
 * Everything currently parked, keyed by alert key.
 *
 * "Currently" means not lifted and not yet expired. An expired row is left in
 * place — it is the record of a decision that has since run its course, and the
 * alert coming back is the system working, not a row needing cleaning up.
 */
export async function activeParks(
  principal: Principal,
  asOf: Date = new Date(),
): Promise<Map<string, Park>> {
  const rows = await db.alertAcknowledgement.findMany({
    where: { ...orgFilter(principal), liftedAt: null, until: { gt: asOf } },
    include: { acknowledgedBy: { select: { name: true } } },
    orderBy: { acknowledgedAt: 'desc' },
  });

  const parks = new Map<string, Park>();
  for (const row of rows) {
    // A key already seen is an older park on the same alert, superseded by the
    // newer one above it. Both rows stay; only the newest one suppresses.
    if (parks.has(row.alertKey)) continue;
    if (!isRule(row.rule)) continue;

    parks.set(row.alertKey, {
      id: row.id,
      alertKey: row.alertKey,
      rule: row.rule,
      note: row.note,
      until: row.until,
      byName: row.acknowledgedBy.name,
      acknowledgedAt: row.acknowledgedAt,
    });
  }
  return parks;
}

/** The shape `withoutAcknowledged` wants: key → when it comes back. */
export function untilByKey(parks: ReadonlyMap<string, Park>): Map<string, Date> {
  return new Map([...parks.values()].map((p) => [p.alertKey, p.until]));
}

/**
 * May this principal park alerts of this rule?
 *
 * BOTH PERMISSIONS, not either. Seeing it is required because parking something
 * you cannot see makes no sense and would let somebody silence a rule by
 * guessing its key; acting on it is required because parking is farm-wide.
 */
export function canPark(principal: Principal, rule: AlertRule): boolean {
  const held = permissionsFor(principal);
  const definition = RULE_CATALOGUE[rule];
  return held.has(definition.permission) && held.has(definition.ackPermission);
}

export async function park(
  principal: Principal,
  input: { alertKey: string; note: string; until: Date },
  asOf: Date = new Date(),
): Promise<{ rule: AlertRule }> {
  // THE KEY IS PARSED, NOT TRUSTED. It arrives from a form field, so the rule
  // part is checked against the catalogue before it is used to decide who may
  // park it — otherwise a made-up rule name would sail past `canPark` and park
  // an alert the sender holds nothing for.
  const rule = ALERT_RULES.find((r) => input.alertKey.startsWith(`${r}:`)) ?? null;
  if (!rule || input.alertKey.length <= rule.length + 1) {
    throw new AlertAckError('That is not an alert this system raises.');
  }

  if (!canPark(principal, rule)) {
    throw new AlertAckError(
      `Parking this is for whoever deals with it. Your account can see ${RULE_CATALOGUE[rule].label.toLowerCase()} but cannot act on it, and parking would silence it for everybody.`,
    );
  }

  const problems = parkErrors({ note: input.note, until: input.until }, asOf);
  if (problems.length > 0) throw new AlertAckError(problems[0]);

  await db.alertAcknowledgement.create({
    data: {
      organisationId: principal.organisationId,
      alertKey: input.alertKey,
      rule,
      note: input.note.trim(),
      until: input.until,
      acknowledgedById: principal.userId,
    },
  });

  return { rule };
}

/**
 * Bring one back.
 *
 * A NEW STATE ON THE SAME ROW, never a delete. That somebody silenced this and
 * then changed their mind is the interesting part of the story, and deleting the
 * row would keep only the ending.
 *
 * Anybody who could have parked it can lift it. Lifting makes the farm noisier,
 * which is the safe direction — it needs no more authority than parking did.
 */
export async function lift(
  principal: Principal,
  parkId: string,
): Promise<{ alertKey: string }> {
  const existing = await db.alertAcknowledgement.findFirst({
    where: { id: parkId, ...orgFilter(principal) },
    select: { id: true, alertKey: true, rule: true, liftedAt: true },
  });
  if (!existing) throw new AlertAckError('That is no longer parked.');
  if (existing.liftedAt) throw new AlertAckError('Somebody has already brought that back.');
  if (!isRule(existing.rule) || !canPark(principal, existing.rule)) {
    throw new AlertAckError('Bringing this back is for whoever deals with it.');
  }

  await db.alertAcknowledgement.update({
    where: { id: parkId },
    data: { liftedAt: new Date(), liftedById: principal.userId },
  });

  return { alertKey: existing.alertKey };
}

/**
 * The history of one alert being silenced — every park, lifted or expired.
 *
 * Not shown on the alert page. It exists because "how long have we been ignoring
 * this?" is a question worth being able to answer, and an alert parked four
 * times running is a different thing from one parked once.
 */
export async function parkHistory(principal: Principal, alertKey: string) {
  return db.alertAcknowledgement.findMany({
    where: { ...orgFilter(principal), alertKey },
    include: {
      acknowledgedBy: { select: { name: true } },
      liftedBy: { select: { name: true } },
    },
    orderBy: { acknowledgedAt: 'desc' },
  });
}
