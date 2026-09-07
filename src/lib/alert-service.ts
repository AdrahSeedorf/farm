import 'server-only';
import { db } from '@/lib/db';
import type { Principal, Permission } from '@/lib/rbac';
import { permissionsFor } from '@/lib/rbac';
import { orgFilter, siteFilter, nestedSiteFilter } from '@/lib/scope';
import {
  buildAlert,
  dedupe,
  sortAlerts,
  visibleTo,
  mortalityLevel,
  thresholdsFrom,
  thresholdBasisSentence,
  recordIsLate,
  RULE_CATALOGUE,
  type Alert,
} from '@/lib/alerts';
import { stockOverview } from '@/lib/stock-service';
import { dueAcrossFlocks } from '@/lib/health-service';
import { withdrawalsAcrossFlocks } from '@/lib/withdrawal-service';
import { outstandingOrders } from '@/lib/order-service';
import { listTasks } from '@/lib/task-service';
import { listIncidents } from '@/lib/incident-service';
import { shiftsBetween } from '@/lib/attendance-service';
import { isOverdue, daysOverdue } from '@/lib/tasks';
import { isUnattended, daysWaiting } from '@/lib/incidents';
import { elapsedHours, STALE_OPEN_SHIFT_HOURS } from '@/lib/attendance';
import { BASE_UNIT, formatQuantity } from '@/lib/uom';

/**
 * Alert gathering — ADRAH Farms
 *
 * Turns the state of the farm into the plain objects `alerts.ts` reasons about.
 * The judgements live there; the reading lives here.
 *
 * NOTHING IS WRITTEN BY THIS FILE. There is no alerts table. Every call
 * recomputes from the ledgers, which is why the list can never disagree with the
 * screen it points at.
 *
 * A GATHERER IS NOT RUN WHEN THE READER MAY NOT SEE ITS RULE.
 *   `gather` checks the permission on the rule before it makes the query. That
 *   is a security property first and a performance one second: a worker opening
 *   this page never causes a read of supplier prices, so there is no row to
 *   leak through a log line or an error message. `visibleTo` at the end is the
 *   second gate, and it is deliberately redundant — a gatherer added later
 *   without its guard is still caught before the response is built.
 *
 * SITE SCOPE IS APPLIED INSIDE EVERY QUERY, never afterwards. Each service
 * called below already does this; the two queries this file makes for itself
 * spread `siteFilter` in the same way.
 */

const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// STOCK
// ---------------------------------------------------------------------------

async function stockAlerts(principal: Principal, asOf: Date): Promise<Alert[]> {
  const rows = await stockOverview(principal, asOf);
  const out: Alert[] = [];

  for (const row of rows) {
    const href = `/inventory/${row.id}`;

    if (row.urgency === 'OUT') {
      out.push(
        buildAlert('stock.out', {
          subject: row.id,
          headline: `${row.name} has run out`,
          detail: row.sentence,
          href,
        }),
      );
    } else if (row.urgency === 'CRITICAL' || row.urgency === 'LOW') {
      out.push(
        buildAlert('stock.short', {
          subject: row.id,
          headline: `${row.name} needs ordering`,
          // The lead-time basis is carried through because "8 days left" is not
          // information until you know the supplier takes ten.
          detail: `${row.sentence} ${row.leadTimeSentence}`,
          href,
          // CRITICAL cover means it runs out before an order placed today could
          // land. That is a harder fact than "getting low", so it is raised.
          level: row.urgency === 'CRITICAL' ? 'CRITICAL' : 'ATTENTION',
        }),
      );
    }

    if (row.expired.length > 0) {
      // Oldest expiry is when this condition actually began — not today.
      const since = row.expired
        .map((b) => b.expiresOn)
        .filter((d): d is Date => d instanceof Date)
        .sort((a, b) => a.getTime() - b.getTime())[0];

      // `onHand` on a batch is already in base units — the same figure
      // `onHandBase` carries on the row above it. Naming it differently at the
      // two levels is a trap this codebase has fallen into three times.
      const quantity = row.expired.reduce((sum, b) => sum + b.onHand, 0);

      out.push(
        buildAlert('stock.expired', {
          subject: row.id,
          headline: `${row.name} has expired stock still counted`,
          detail: `${row.expired.length} batch${row.expired.length === 1 ? '' : 'es'} — ${formatQuantity(quantity, BASE_UNIT[row.dimension], row.unitKey)}. Every days-of-cover figure on this item is overstated until it is written off.`,
          href,
          since: since ?? null,
        }),
      );
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// HEALTH
// ---------------------------------------------------------------------------

async function healthAlerts(principal: Principal, asOf: Date): Promise<Alert[]> {
  const [due, restricted] = await Promise.all([
    dueAcrossFlocks(principal, asOf),
    withdrawalsAcrossFlocks(principal, asOf),
  ]);

  const out: Alert[] = [];
  const draftProgrammes = new Set<string>();

  for (const d of due) {
    const where = d.houseName ?? d.flockCode;
    const href = `/flocks/${d.flockId}/health`;

    if (d.entry.status === 'OVERDUE') {
      out.push(
        buildAlert('health.overdue', {
          subject: `${d.flockId}:${d.entry.item.id}`,
          headline: `${d.entry.item.name} is overdue for ${where}`,
          detail: `Due ${iso(d.entry.dueOn)} on the ${d.programmeName} programme, ${d.entry.daysFromDue} day${d.entry.daysFromDue === 1 ? '' : 's'} ago.`,
          href,
          since: d.entry.windowEndsOn,
        }),
      );
    } else {
      out.push(
        buildAlert('health.due', {
          subject: `${d.flockId}:${d.entry.item.id}`,
          headline: `${d.entry.item.name} is due for ${where}`,
          detail: `Due ${iso(d.entry.dueOn)} on the ${d.programmeName} programme. The vaccine has to be in the store before the day.`,
          href,
        }),
      );
    }

    // ONE PER FLOCK, not one per scheduled dose. A programme with fourteen items
    // on it would otherwise put fourteen identical notices on the page.
    if (d.programmeStatus === 'DRAFT') draftProgrammes.add(`${d.flockId}|${where}|${d.programmeName}`);
  }

  for (const entry of draftProgrammes) {
    const [flockId, where, programmeName] = entry.split('|');
    out.push(
      buildAlert('health.unreviewed', {
        subject: flockId,
        headline: `${where} is following a programme no vet has signed off`,
        detail: `${programmeName} is still a draft. The doses are being scheduled either way — this says only that nobody with a veterinary qualification has looked at the schedule.`,
        href: `/health`,
      }),
    );
  }

  for (const f of restricted) {
    const where = f.houseName ?? f.flockCode;
    const parts: string[] = [];
    if (f.eggsClearOn) parts.push(`no eggs until ${iso(f.eggsClearOn)}`);
    if (f.meatClearsOn) parts.push(`no birds until ${iso(f.meatClearsOn)}`);
    if (parts.length === 0) continue;

    out.push(
      buildAlert('health.withdrawal', {
        subject: f.flockId,
        headline: `${where} is inside a withdrawal period`,
        detail: `${parts.join('; ')}. Selling inside a withdrawal period is a food-safety breach.`,
        href: `/flocks/${f.flockId}/health`,
      }),
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// MORTALITY
// ---------------------------------------------------------------------------

/**
 * Deaths today against the figure set for the flock's stage.
 *
 * CULLS ARE NOT COUNTED HERE, and the population ledger's `DEATH_EVENT_TYPES`
 * (which includes them) is deliberately not used. A cull is a deliberate act —
 * thinning forty poor birds before transfer is a decision somebody made, and
 * raising a mortality alarm about it teaches the farm that the alarm means
 * nothing. Culls still count in every cumulative loss figure; they are just not
 * a signal that something has gone wrong today.
 *
 * Three queries for the whole farm, whatever the number of flocks.
 */
async function mortalityAlerts(principal: Principal, asOf: Date): Promise<Alert[]> {
  const today = startOfDay(asOf);
  const weekAgo = new Date(today.getTime() - 7 * DAY_MS);

  const [flocks, farm] = await Promise.all([
    db.animalGroup.findMany({
      // AnimalGroup has NO organisationId column — it reaches the organisation
      // through its site, so the org filter is nested. Spreading it flat here
      // threw, and the page still rendered the other six readings, which is what
      // the per-gatherer isolation below is for.
      where: { site: orgFilter(principal), ...siteFilter(principal), closedAt: null },
      select: {
        id: true,
        code: true,
        siteId: true,
        productionUnit: { select: { name: true } },
        currentStage: {
          select: { name: true, mortalityAttentionPct: true, mortalityCriticalPct: true },
        },
      },
    }),
    db.organisation.findUnique({
      where: { id: principal.organisationId },
      select: {
        mortalityAttentionPct: true,
        mortalityCriticalPct: true,
        mortalitySpikeMultiple: true,
        mortalitySpikeFloorDeaths: true,
      },
    }),
  ]);

  if (flocks.length === 0 || !farm) return [];
  const ids = flocks.map((f) => f.id);

  const [recent, priorNet] = await Promise.all([
    // Deaths per flock per day, today and the seven days before it.
    db.animalGroupEvent.groupBy({
      by: ['animalGroupId', 'occurredOn'],
      where: { animalGroupId: { in: ids }, type: 'MORTALITY', occurredOn: { gte: weekAgo } },
      _sum: { delta: true },
    }),
    // THE OPENING POPULATION: every event dated BEFORE today, summed. The
    // denominator has to be the birds that were alive this morning — dividing
    // today's deaths by a number those same deaths have already been taken out
    // of overstates the rate, and overstates it most in exactly the situation
    // the rule exists to catch.
    db.animalGroupEvent.groupBy({
      by: ['animalGroupId'],
      where: { animalGroupId: { in: ids }, occurredOn: { lt: today } },
      _sum: { delta: true },
    }),
  ]);

  const opening = new Map(priorNet.map((r) => [r.animalGroupId, r._sum.delta ?? 0]));

  const deathsByFlock = new Map<string, { today: number; prior: number[] }>();
  for (const id of ids) deathsByFlock.set(id, { today: 0, prior: [] });

  for (const row of recent) {
    const bucket = deathsByFlock.get(row.animalGroupId);
    if (!bucket) continue;
    // Deltas are negative for deaths; the rule counts birds, not direction.
    const deaths = Math.abs(row._sum.delta ?? 0);
    if (row.occurredOn.getTime() >= today.getTime()) bucket.today += deaths;
    else bucket.prior.push(deaths);
  }

  const out: Alert[] = [];

  for (const flock of flocks) {
    const bucket = deathsByFlock.get(flock.id);
    if (!bucket || bucket.today === 0) continue;

    const openingPopulation = opening.get(flock.id) ?? 0;
    if (openingPopulation <= 0) continue;

    // A DAY WITH NO DEATHS LEAVES NO ROW, so the days between the recorded ones
    // have to be put back as zeros. Averaging only the days somebody died turns
    // "one death last week" into "one a day", and the spike rule then never
    // fires — the exact opposite of what it is for.
    const prior = [...bucket.prior];
    while (prior.length < 7) prior.push(0);

    const thresholds = thresholdsFrom(flock.currentStage, farm);
    const verdict = mortalityLevel(
      { deathsToday: bucket.today, openingPopulation, priorDailyDeaths: prior },
      thresholds,
    );
    if (!verdict) continue;

    const where = flock.productionUnit?.name ?? flock.code;
    out.push(
      buildAlert(verdict.rule, {
        subject: flock.id,
        headline: `${where} — ${bucket.today} death${bucket.today === 1 ? '' : 's'} today`,
        detail: `${verdict.sentence} ${thresholdBasisSentence(flock.currentStage)}`,
        href: `/flocks/${flock.id}`,
        siteId: flock.siteId,
        since: today,
        level: verdict.level,
      }),
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// THE MISSING DAILY RECORD
// ---------------------------------------------------------------------------

/**
 * Houses with birds in them and nothing written down today.
 *
 * SILENT UNTIL THE CUT-OFF. Before then a missing record means the morning is
 * still in progress, and an alert list that says so every day at six is a list
 * nobody reads by the end of the week.
 *
 * The cut-off is compared in the farm's own timezone. Ghana keeps UTC and has no
 * daylight saving, so for ADRAH the two are the same hour — but the timezone is
 * read rather than assumed, because a system that quietly hard-codes UTC is one
 * that reports the wrong day the first time it is used anywhere else.
 */
async function dailyRecordAlerts(principal: Principal, asOf: Date): Promise<Alert[]> {
  const org = await db.organisation.findUnique({
    where: { id: principal.organisationId },
    select: { timezone: true, recordDueHour: true },
  });
  if (!org) return [];

  const localHour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: org.timezone,
      hour: 'numeric',
      hour12: false,
    }).format(asOf),
  );
  if (!recordIsLate(localHour, org.recordDueHour)) return [];

  const today = startOfDay(asOf);

  const flocks = await db.animalGroup.findMany({
    where: {
      site: orgFilter(principal),
      ...siteFilter(principal),
      closedAt: null,
      productionUnitId: { not: null },
      // A flock delivered tomorrow has nothing to record today.
      arrivalDate: { lte: today },
    },
    select: {
      id: true,
      code: true,
      siteId: true,
      productionUnit: { select: { name: true } },
      dailyRecords: { where: { onDate: today }, select: { id: true }, take: 1 },
    },
  });

  return flocks
    .filter((f) => f.dailyRecords.length === 0)
    .map((f) =>
      buildAlert('record.missing', {
        subject: f.id,
        headline: `No record yet for ${f.productionUnit?.name ?? f.code}`,
        detail: `Nothing entered today, and it is past ${org.recordDueHour}:00. A day nobody counted the birds cannot be recovered afterwards.`,
        href: `/daily`,
        siteId: f.siteId,
        since: today,
      }),
    );
}

// ---------------------------------------------------------------------------
// PROCUREMENT, TASKS, INCIDENTS, ATTENDANCE
// ---------------------------------------------------------------------------

async function orderAlerts(principal: Principal, asOf: Date): Promise<Alert[]> {
  const orders = await outstandingOrders(principal, asOf);

  return orders
    .filter((o) => o.timing.status === 'LATE')
    .map((o) =>
      buildAlert('order.late', {
        subject: o.id,
        headline: `${o.orderNumber} from ${o.supplierName} is late`,
        detail: `${o.timingSentence} ${o.fulfilmentSentence}`,
        href: `/purchases/${o.id}`,
        siteId: o.siteId,
        since: o.expectedOn,
      }),
    );
}

async function taskAlerts(principal: Principal, asOf: Date): Promise<Alert[]> {
  const tasks = await listTasks(principal, { asOf });

  return tasks
    .filter((t) => isOverdue(t, asOf))
    .map((t) => {
      const late = daysOverdue(t, asOf);
      return buildAlert('task.overdue', {
        subject: t.id,
        headline: t.title,
        detail: `${late === null ? 'Overdue' : `${late} day${late === 1 ? '' : 's'} past its date`} — ${t.assigneeName ?? 'nobody in particular'}.`,
        href: `/tasks`,
        siteId: t.siteId,
        since: t.dueOn,
        // An urgent task that has gone past its date is the one case where a
        // task is worth the top of the list.
        level: t.priority === 'URGENT' ? 'CRITICAL' : 'ATTENTION',
      });
    });
}

async function incidentAlerts(principal: Principal, asOf: Date): Promise<Alert[]> {
  const incidents = await listIncidents(principal, { asOf });

  return incidents
    .filter((i) => isUnattended(i, asOf))
    .map((i) =>
      buildAlert('incident.unattended', {
        subject: i.id,
        headline: `${i.reference} — nobody has looked at this`,
        detail: `${i.what.slice(0, 140)}${i.what.length > 140 ? '…' : ''} Reported by ${i.reportedByName}, waiting ${daysWaiting(i, asOf)} days.`,
        href: `/incidents`,
        siteId: i.siteId,
        since: i.reportedAt,
      }),
    );
}

async function attendanceAlerts(principal: Principal, asOf: Date): Promise<Alert[]> {
  // Three days back: long enough to catch a clock-out forgotten over a weekend,
  // short enough not to read a year of events on a dashboard load.
  const shifts = await shiftsBetween(principal, new Date(asOf.getTime() - 3 * DAY_MS), asOf);

  return shifts
    .filter((s) => {
      if (s.state !== 'OPEN' || !s.startedAt) return false;
      return (elapsedHours(s.startedAt, asOf) ?? 0) >= STALE_OPEN_SHIFT_HOURS;
    })
    .map((s) =>
      buildAlert('attendance.openShift', {
        subject: s.id ?? s.userId,
        headline: `${s.userName} is still clocked in`,
        detail: `${Math.floor(elapsedHours(s.startedAt!, asOf) ?? 0)} hours since clocking in. Almost always a forgotten clock-out — somebody with attendance access can correct it.`,
        href: `/attendance`,
        siteId: s.siteId,
        since: s.startedAt,
      }),
    );
}

// ---------------------------------------------------------------------------
// PUTTING IT TOGETHER
// ---------------------------------------------------------------------------

type Gatherer = (principal: Principal, asOf: Date) => Promise<Alert[]>;

/**
 * Which permission has to be held before a gatherer is allowed to run.
 *
 * Derived from the rule catalogue rather than typed again, so a rule whose
 * permission changes cannot leave its gatherer guarded by the old one.
 */
const GATHERERS: { permission: Permission; gather: Gatherer }[] = [
  { permission: RULE_CATALOGUE['stock.out'].permission, gather: stockAlerts },
  { permission: RULE_CATALOGUE['health.overdue'].permission, gather: healthAlerts },
  { permission: RULE_CATALOGUE['mortality.high'].permission, gather: mortalityAlerts },
  { permission: RULE_CATALOGUE['record.missing'].permission, gather: dailyRecordAlerts },
  { permission: RULE_CATALOGUE['order.late'].permission, gather: orderAlerts },
  { permission: RULE_CATALOGUE['task.overdue'].permission, gather: taskAlerts },
  { permission: RULE_CATALOGUE['incident.unattended'].permission, gather: incidentAlerts },
  { permission: RULE_CATALOGUE['attendance.openShift'].permission, gather: attendanceAlerts },
];

/**
 * Every alert this principal should see, worst first.
 *
 * A GATHERER THAT FAILS DOES NOT TAKE THE PAGE WITH IT.
 *   The alert list is the first screen somebody opens in the morning, and it is
 *   assembled from eight independent readings of the farm. If the health
 *   schedule throws, the right answer is a page that shows the other seven and
 *   says plainly that one reading is missing — not a 500 that hides the feed
 *   running out as well. `failed` carries the names out so the page can say so
 *   rather than quietly showing a shorter list.
 */
export interface AlertsResult {
  alerts: Alert[];
  /** Permissions whose gatherer threw. The page tells the reader. */
  failed: Permission[];
}

export async function alertsFor(
  principal: Principal,
  asOf: Date = new Date(),
): Promise<AlertsResult> {
  const held = permissionsFor(principal);

  const settled = await Promise.all(
    GATHERERS.filter((g) => held.has(g.permission)).map(async (g) => {
      try {
        return { permission: g.permission, alerts: await g.gather(principal, asOf) };
      } catch (error) {
        console.error(`Alert gatherer for ${g.permission} failed`, error);
        return { permission: g.permission, alerts: null };
      }
    }),
  );

  const alerts = settled.flatMap((s) => s.alerts ?? []);
  const failed = settled.filter((s) => s.alerts === null).map((s) => s.permission);

  // `visibleTo` is redundant given the guard above, and stays on purpose: it is
  // the check that still holds if somebody adds a gatherer and forgets one.
  return { alerts: sortAlerts(visibleTo(dedupe(alerts), held)), failed };
}

/**
 * The sites this principal can see, for the filter on the alerts page.
 */
export async function alertSites(principal: Principal) {
  return db.productionUnit
    .findMany({
      where: { ...nestedSiteFilter(principal), isActive: true },
      select: { site: { select: { id: true, name: true } } },
      distinct: ['siteId'],
      orderBy: { site: { name: 'asc' } },
    })
    .then((rows) => rows.map((r) => r.site));
}
