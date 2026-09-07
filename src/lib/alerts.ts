import type { Permission } from '@/lib/rbac';
import { dailyMortalityPct } from '@/lib/metrics';

/**
 * Alerts — ADRAH Farms
 *
 * The owner's command centre. Pure; no database.
 *
 * WHAT AN ALERT IS HERE
 *   A statement that something has gone past a line somebody chose, is not
 *   already being dealt with, and can still be acted on. All three clauses do
 *   work. A figure that is merely interesting is a dashboard tile, not an alert.
 *
 * ALERTS ARE DERIVED, NEVER STORED.
 *   There is no alerts table and nothing writes one. Every alert on this page is
 *   recomputed from the same ledgers the underlying screens read, which means a
 *   condition that clears — feed arrives, the vaccination is given — simply
 *   stops appearing, with no reconciliation job to go wrong and no possibility
 *   of the alert list disagreeing with the screen it points at. Storing alerts
 *   would give this system a second, staler copy of facts it already holds.
 *
 *   What IS stored is the human act: somebody saying "I have seen this, stop
 *   telling me until Friday." That is a decision a person made, not a fact about
 *   the farm, and it is kept. See the acknowledgement task.
 *
 * THE FAILURE MODE IS FATIGUE, NOT SILENCE.
 *   An alert list with forty rows on it every morning is read once and never
 *   again, and then the one row that mattered goes unread for a fortnight. So
 *   this module is arranged to say less: rules that overlap resolve to the worst
 *   one only (see `dedupe`), rules that would fire on every ordinary day have
 *   floors under them (see `mortalityLevel`), and the page groups rather than
 *   lists. Every rule added here has to earn a line on a phone screen at 6:30am.
 *
 * NO CLINICAL JUDGEMENT IS MADE HERE.
 *   The mortality thresholds this module compares against are DATA, carried on
 *   the lifecycle stage, with the seeded figures marked as starting points for a
 *   vet to revise. Nothing in this file knows what a normal death rate is, and
 *   nothing in it will ever change a threshold on its own. It compares a number
 *   to a number a person put there.
 *
 * DELIVERY IS OUT OF SCOPE BY DECISION.
 *   In-app only. No SMS, no WhatsApp, no email — those need a provider, a cost
 *   per message and a decision about which of them wakes somebody at 3am, none
 *   of which have been settled. Nothing here assumes in-app is the end state:
 *   an alert is a plain object with a level and a permission on it, which is
 *   exactly what a channel would need when one is chosen.
 */

// ---------------------------------------------------------------------------
// LEVELS
// ---------------------------------------------------------------------------

/**
 * Three levels, named for what to do rather than how bad it is.
 *
 * "High / medium / low" describes the alert. These describe the response, which
 * is the only thing the reader actually wants to know:
 *
 *   CRITICAL   Something is being lost right now, or a rule is being broken.
 *              Deal with it today.
 *   ATTENTION  Nothing is lost yet, but the window to act is closing.
 *   NOTICE     Worth knowing. Nothing is wrong.
 *
 * There is no fourth level, and nothing is louder than CRITICAL. A rule that
 * wants to be more urgent than "deal with it today" is a rule asking for a
 * privilege the next rule will also want.
 */
export const ALERT_LEVELS = ['CRITICAL', 'ATTENTION', 'NOTICE'] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

const LEVEL_RANK: Record<AlertLevel, number> = {
  CRITICAL: 0,
  ATTENTION: 1,
  NOTICE: 2,
};

export const LEVEL_LABELS: Record<AlertLevel, string> = {
  CRITICAL: 'Deal with today',
  ATTENTION: 'Needs attention',
  NOTICE: 'Worth knowing',
};

export function worst(levels: AlertLevel[]): AlertLevel | null {
  if (levels.length === 0) return null;
  return [...levels].sort((a, b) => LEVEL_RANK[a] - LEVEL_RANK[b])[0];
}

// ---------------------------------------------------------------------------
// THE RULE CATALOGUE
// ---------------------------------------------------------------------------

/**
 * Every rule this system has, in one list.
 *
 * IN ONE PLACE ON PURPOSE. The question "why is the system telling me this?"
 * has to have an answer a person can read, and the question "what is it NOT
 * telling me?" has to be answerable at all. A rule invented inline in whichever
 * page happened to need it is a rule nobody can audit.
 *
 * Rule keys are stable strings. They end up in acknowledgement records and in
 * the audit log, so renaming one is a migration, not a rename.
 */
export const ALERT_RULES = [
  'stock.out',
  'stock.short',
  'stock.expired',
  'health.overdue',
  'health.due',
  'health.withdrawal',
  'health.unreviewed',
  'mortality.high',
  'mortality.spike',
  'record.missing',
  'order.late',
  'task.overdue',
  'incident.unattended',
  'attendance.openShift',
] as const;
export type AlertRule = (typeof ALERT_RULES)[number];

export interface RuleDefinition {
  /** What to call this rule on screen. A heading, not a sentence. */
  label: string;
  /** The level this rule fires at, unless the builder raises it. */
  level: AlertLevel;
  /**
   * THE PERMISSION REQUIRED TO SEE THE ALERT AT ALL.
   *
   * Not a display hint. `visibleTo` drops anything the reader does not hold, and
   * the page that renders alerts calls it with permissions resolved server-side
   * from the session — so a worker who reaches /alerts never receives the row
   * about an overdue purchase order, rather than receiving it and being asked
   * not to look. Hiding it in the markup would put the supplier's price in the
   * HTML source of a page a worker can open.
   */
  permission: Permission;
  /** What the rule watches, in one line, shown on the rules screen. */
  what: string;
  /** Why it is worth interrupting somebody for. */
  why: string;
}

export const RULE_CATALOGUE: Record<AlertRule, RuleDefinition> = {
  'stock.out': {
    label: 'Out of stock',
    level: 'CRITICAL',
    permission: 'inventory:view',
    what: 'An item in regular use has nothing left.',
    why: 'Birds do not wait for a delivery. This is the one stock condition that costs money the same day.',
  },
  'stock.short': {
    label: 'Needs ordering',
    level: 'ATTENTION',
    permission: 'inventory:view',
    what: 'Stock will run out before a delivery ordered today could arrive.',
    why: 'Measured against the supplier’s own lead time, so it fires when ordering has to start — not at a number of days that means nothing on its own.',
  },
  'stock.expired': {
    label: 'Expired stock still counted',
    level: 'ATTENTION',
    permission: 'inventory:view',
    what: 'A batch is past its expiry date and still counted as stock.',
    why: 'It inflates every days-of-cover figure on the farm, and somebody will eventually use it.',
  },
  'health.overdue': {
    label: 'Health programme overdue',
    level: 'CRITICAL',
    permission: 'health:view',
    what: 'A scheduled vaccination or treatment has passed its date.',
    why: 'The programme is the farm’s own; missing a date on it is the farm departing from a plan it made.',
  },
  'health.due': {
    label: 'Health programme due',
    level: 'ATTENTION',
    permission: 'health:view',
    what: 'A scheduled vaccination or treatment falls due shortly.',
    why: 'Vaccines have to be in the store before the day, and the store is two weeks from the supplier.',
  },
  'health.withdrawal': {
    label: 'Withdrawal period in force',
    level: 'CRITICAL',
    permission: 'health:view',
    what: 'A withdrawal period is in force — produce from this flock must not be sold.',
    why: 'Selling inside a withdrawal period is a food-safety breach, not an inefficiency.',
  },
  'health.unreviewed': {
    label: 'Programme not vet-reviewed',
    level: 'NOTICE',
    permission: 'health:view',
    what: 'A flock is following a health programme no vet has signed off.',
    why: 'The software will schedule the doses either way. Whether a vet has looked at the schedule is a fact the farm should be able to see, not one it discovers during an inspection.',
  },
  'mortality.high': {
    label: 'Deaths above the threshold',
    level: 'CRITICAL',
    permission: 'flock:view',
    what: 'Deaths in a day exceeded the figure set for that stage of life.',
    why: 'The earliest signal of disease a farm gets without a laboratory.',
  },
  'mortality.spike': {
    label: 'Deaths above the recent average',
    level: 'ATTENTION',
    permission: 'flock:view',
    what: 'Deaths today are several times the recent daily average.',
    why: 'Catches a flock whose absolute rate is still inside the threshold but whose shape has changed.',
  },
  'record.missing': {
    label: 'No record entered today',
    level: 'ATTENTION',
    permission: 'dailyRecord:view',
    what: 'A house has no record for today by the cut-off time.',
    why: 'A missing day is not a gap in a report — it is a day nobody counted the birds, and it cannot be recovered afterwards.',
  },
  'order.late': {
    label: 'Order is late',
    level: 'ATTENTION',
    permission: 'procurement:view',
    what: 'A purchase order is past the date it was expected and still not fully received.',
    why: 'A late order is only discovered by asking. Nobody asks on a busy morning.',
  },
  'task.overdue': {
    label: 'Task overdue',
    level: 'ATTENTION',
    permission: 'task:view',
    what: 'A task is past its due date and not finished.',
    why: 'Tasks with dates on them were given dates for a reason.',
  },
  'incident.unattended': {
    label: 'Report nobody has read',
    level: 'CRITICAL',
    permission: 'incident:view',
    what: 'Somebody reported something and nobody has recorded looking at it.',
    why: 'The reporting rate is the only number this module has, and it collapses the first time a report is ignored.',
  },
  'attendance.openShift': {
    label: 'Still clocked in',
    level: 'ATTENTION',
    permission: 'attendance:view',
    what: 'Somebody is still clocked in long after any plausible shift.',
    why: 'Almost always a forgotten clock-out. Occasionally it is not, and that is the case worth checking.',
  },
};

// ---------------------------------------------------------------------------
// THE ALERT
// ---------------------------------------------------------------------------

export interface Alert {
  /**
   * Stable identity: `rule:subject`.
   *
   * The same condition on the same subject produces the same key on every
   * recomputation, which is what lets an acknowledgement bind to it. It must not
   * contain anything that changes while the condition persists — no timestamp,
   * no count — or dismissing an alert on Monday would fail to dismiss the
   * identical alert on Tuesday.
   */
  key: string;
  rule: AlertRule;
  level: AlertLevel;
  /** What has happened, in the fewest words that are still true. */
  headline: string;
  /** The number, the name, the date — whatever makes it actionable. */
  detail: string;
  /** Where to go to do something about it. */
  href: string;
  /** Null for an organisation-wide condition. */
  siteId: string | null;
  /** When the condition began, where that is knowable. Drives ordering. */
  since: Date | null;
}

export function buildAlert(
  rule: AlertRule,
  input: {
    subject: string;
    headline: string;
    detail: string;
    href: string;
    siteId?: string | null;
    since?: Date | null;
    /** Raises or lowers the catalogue level for this instance only. */
    level?: AlertLevel;
  },
): Alert {
  return {
    key: `${rule}:${input.subject}`,
    rule,
    level: input.level ?? RULE_CATALOGUE[rule].level,
    headline: input.headline,
    detail: input.detail,
    href: input.href,
    siteId: input.siteId ?? null,
    since: input.since ?? null,
  };
}

// ---------------------------------------------------------------------------
// MORTALITY — the only rule in this file with arithmetic in it
// ---------------------------------------------------------------------------

/**
 * How much death is normal, per stage of life.
 *
 * THESE NUMBERS ARE NOT IN THIS FILE. They are carried on the lifecycle stage,
 * which is data belonging to the production type, for two reasons that both
 * matter:
 *
 *   1. A brooding chick and a hen in lay are not comparable. Week-one mortality
 *      of around 1% is ordinary; the same rate in lay is an outbreak. One flat
 *      daily figure either screams through every brooding period or stays silent
 *      through a real one, and a threshold that is wrong at both ends is worse
 *      than none because it teaches people to ignore it.
 *
 *   2. This platform is not a poultry platform. Reading `stage === 'BROODING'`
 *      here would put a poultry word in the core and be wrong the day it carries
 *      a second species. The stage knows its own figures.
 *
 * The seeded values are STARTING POINTS taken from published breed material and
 * marked as such on the settings screen, for a vet to revise. Nothing in this
 * software changes them.
 */
export interface MortalityThresholds {
  /** Daily deaths as a percentage of the opening population. */
  attentionPct: number;
  criticalPct: number;
  /**
   * How many times the recent daily average counts as a spike.
   *
   * Three. Two fires on ordinary variation in small numbers; four is late.
   */
  spikeMultiple: number;
  /**
   * THE FLOOR UNDER THE SPIKE RULE, in birds, and the reason the rule is usable.
   *
   * A healthy flock of 2,000 layers loses roughly one bird every four days, so
   * the seven-day mean sits near 0.29. Three times that is 0.86 — meaning a
   * single dead bird, on an ordinary Tuesday, satisfies "three times the
   * average". Without a floor this rule fires most days and is switched off
   * within a week, taking the case it was built for with it.
   */
  spikeFloorDeaths: number;
}

export const DEFAULT_MORTALITY_THRESHOLDS: MortalityThresholds = {
  attentionPct: 0.1,
  criticalPct: 0.25,
  spikeMultiple: 3,
  spikeFloorDeaths: 3,
};

/**
 * Resolve the figures for one flock: its stage's, falling back to the farm's.
 *
 * FIELD BY FIELD, NOT OBJECT BY OBJECT. A stage that sets a critical figure and
 * leaves the attention one blank should inherit the second, not lose it — and an
 * all-or-nothing fallback would silently drop a threshold somebody had entered
 * on the same screen.
 */
export function thresholdsFrom(
  stage: { mortalityAttentionPct: number | null; mortalityCriticalPct: number | null } | null,
  farm: {
    mortalityAttentionPct: number;
    mortalityCriticalPct: number;
    mortalitySpikeMultiple: number;
    mortalitySpikeFloorDeaths: number;
  },
): MortalityThresholds {
  return {
    attentionPct: stage?.mortalityAttentionPct ?? farm.mortalityAttentionPct,
    criticalPct: stage?.mortalityCriticalPct ?? farm.mortalityCriticalPct,
    spikeMultiple: farm.mortalitySpikeMultiple,
    spikeFloorDeaths: farm.mortalitySpikeFloorDeaths,
  };
}

/**
 * Where a threshold came from, said out loud on the alert.
 *
 * "0.25% set for this stage" is checkable; "the system flagged high mortality"
 * is not. Somebody who disagrees with the alert needs to know which number to go
 * and change, and a farm following a figure it never chose is a farm that will
 * eventually switch the whole list off.
 */
export function thresholdBasisSentence(
  stage: { name: string; mortalityCriticalPct: number | null } | null,
): string {
  if (stage && stage.mortalityCriticalPct !== null) {
    return `Threshold set for ${stage.name}. Change it in the production type settings.`;
  }
  return 'Threshold is the farm-wide figure — this stage has none of its own. Set one in the production type settings.';
}

export interface MortalityVerdict {
  level: AlertLevel;
  rule: 'mortality.high' | 'mortality.spike';
  /** The sentence shown to the reader; states the comparison, not a diagnosis. */
  sentence: string;
}

/**
 * Judge one flock's deaths for one day.
 *
 * THE FORMULAS, in full:
 *
 *   dailyMortalityPct = deathsToday ÷ openingPopulation × 100
 *
 *   HIGH      fires when dailyMortalityPct ≥ criticalPct  → CRITICAL
 *             or when dailyMortalityPct ≥ attentionPct    → ATTENTION
 *
 *   SPIKE     fires when deathsToday ≥ spikeMultiple × mean7
 *                    AND deathsToday ≥ spikeFloorDeaths
 *             where mean7 = deaths over the previous 7 COMPLETE days ÷ 7.
 *
 * Today is excluded from mean7 deliberately — a rate cannot be several times an
 * average it is itself inside, and including it would flatten exactly the spike
 * the rule exists to catch.
 *
 * Only the worse of the two is returned. A day that is both high and a spike is
 * one thing that happened, and reporting it twice on a phone screen is how a
 * list of six real problems becomes a list of twelve.
 *
 * This says a number crossed a line. It does not say what is wrong with the
 * birds, and no wording produced here suggests a cause or a treatment.
 */
export function mortalityLevel(
  input: {
    deathsToday: number;
    openingPopulation: number;
    /** Deaths on each of the previous seven complete days. Shorter is fine. */
    priorDailyDeaths: number[];
  },
  thresholds: MortalityThresholds = DEFAULT_MORTALITY_THRESHOLDS,
): MortalityVerdict | null {
  const { deathsToday, openingPopulation, priorDailyDeaths } = input;
  if (deathsToday <= 0 || openingPopulation <= 0) return null;

  const raw = dailyMortalityPct(deathsToday, openingPopulation);
  if (raw === null) return null;

  // COMPARED AT THREE DECIMAL PLACES, and the same figure is shown.
  //
  // 2 deaths in 2,000 birds is 0.1% in arithmetic and 0.10000000000000002% in
  // binary floating point, which sits either side of a 0.1 threshold depending
  // on the flock size — so the identical situation would alert on one house and
  // not the next. Rounding once, before the comparison, makes the rule behave
  // the way the number on the screen says it does.
  const pct = Math.round(raw * 1000) / 1000;
  const shown = pct;

  if (pct >= thresholds.criticalPct) {
    return {
      level: 'CRITICAL',
      rule: 'mortality.high',
      sentence: `${deathsToday} today — ${shown}% of the flock, against ${thresholds.criticalPct}% set for this stage.`,
    };
  }
  if (pct >= thresholds.attentionPct) {
    return {
      level: 'ATTENTION',
      rule: 'mortality.high',
      sentence: `${deathsToday} today — ${shown}% of the flock, against ${thresholds.attentionPct}% set for this stage.`,
    };
  }

  // Below both lines in absolute terms. Has the shape changed?
  if (priorDailyDeaths.length === 0) return null;
  const mean = priorDailyDeaths.reduce((a, b) => a + b, 0) / priorDailyDeaths.length;
  const meanShown = Math.round(mean * 100) / 100;

  if (
    deathsToday >= thresholds.spikeFloorDeaths &&
    deathsToday >= thresholds.spikeMultiple * mean
  ) {
    return {
      level: 'ATTENTION',
      rule: 'mortality.spike',
      sentence: `${deathsToday} today against ${meanShown} a day over the last ${priorDailyDeaths.length} days. Still inside the threshold, but the shape has changed.`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// THE DAILY RECORD CUT-OFF
// ---------------------------------------------------------------------------

/**
 * When a missing daily record becomes worth saying something about.
 *
 * TEN IN THE MORNING, and it is a setting. Collection and the morning walk are
 * done well before then on any working farm, so a house with nothing recorded by
 * ten is a house nobody has entered a record for — not a house whose record is
 * still being written. Firing at first light would mark every house missing
 * every morning, which is the fatigue failure in its purest form.
 *
 * The comparison is made in the farm's own timezone by the caller. This function
 * takes the local hour, because a module that resolves timezones is a module
 * that needs a database.
 */
export const DEFAULT_RECORD_DUE_HOUR = 10;

export function recordIsLate(localHour: number, dueHour = DEFAULT_RECORD_DUE_HOUR): boolean {
  return localHour >= dueHour;
}

// ---------------------------------------------------------------------------
// ORDERING, DEDUPING, FILTERING
// ---------------------------------------------------------------------------

/**
 * Two rules about the same subject collapse to the worse one.
 *
 * An item that is out of stock is also short of stock, and a flock over its
 * critical threshold is also above its attention threshold. Saying both is not
 * more informative; it is the same problem taking two lines on a phone.
 *
 * Subject identity is the part of the key after the rule, so `stock.out:item-4`
 * and `stock.short:item-4` are recognised as the same thing. The whole-key
 * duplicate case — the same rule firing twice on one subject — is caught here
 * too, and is a bug in a builder rather than a real condition.
 */
export function dedupe(alerts: Alert[]): Alert[] {
  const bySubject = new Map<string, Alert>();
  for (const alert of alerts) {
    const subject = alert.key.slice(alert.rule.length + 1);
    const family = alert.rule.split('.')[0];
    const id = `${family}:${subject}`;
    const held = bySubject.get(id);
    if (!held || LEVEL_RANK[alert.level] < LEVEL_RANK[held.level]) {
      bySubject.set(id, alert);
    }
  }
  return [...bySubject.values()];
}

/**
 * Worst first; within a level, the one that has been waiting longest.
 *
 * AGE BREAKS THE TIE, NOT SEVERITY WITHIN A LEVEL. Two critical alerts are both
 * "deal with today"; the one that has been saying so since Tuesday is the one
 * being ignored, and it goes on top. An alert with no knowable start date sorts
 * after dated ones at the same level rather than being assumed either fresh or
 * ancient.
 */
export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => {
    const level = LEVEL_RANK[a.level] - LEVEL_RANK[b.level];
    if (level !== 0) return level;
    if (a.since && b.since) return a.since.getTime() - b.since.getTime();
    if (a.since) return -1;
    if (b.since) return 1;
    return a.headline.localeCompare(b.headline);
  });
}

/**
 * Drop everything the reader is not allowed to see.
 *
 * CALLED SERVER-SIDE, WITH PERMISSIONS RESOLVED FROM THE SESSION. This is a
 * filter on data, not on markup: an alert a worker may not see never reaches the
 * response at all, so there is nothing in the page source to find. Site scope is
 * applied separately and earlier, inside the queries that gather the signals —
 * filtering by site here would mean the rows had already been read.
 */
export function visibleTo(alerts: Alert[], held: ReadonlySet<Permission>): Alert[] {
  return alerts.filter((a) => held.has(RULE_CATALOGUE[a.rule].permission));
}

/**
 * Hide what somebody has already said they have seen.
 *
 * Acknowledgements arrive as keys with an expiry; an entry whose `until` has
 * passed no longer suppresses. Kept separate from `visibleTo` because the two
 * answer different questions — "may they see it" and "do they still want to" —
 * and conflating them would make a permission failure look like a dismissal.
 */
export function withoutAcknowledged(
  alerts: Alert[],
  acknowledged: ReadonlyMap<string, Date | null>,
  asOf: Date = new Date(),
): Alert[] {
  return alerts.filter((a) => {
    if (!acknowledged.has(a.key)) return true;
    const until = acknowledged.get(a.key) ?? null;
    return until !== null && until.getTime() <= asOf.getTime();
  });
}

// ---------------------------------------------------------------------------
// SAYING IT IN ONE LINE
// ---------------------------------------------------------------------------

export interface AlertSummary {
  total: number;
  critical: number;
  attention: number;
  notice: number;
  /** The line under the tile. */
  sentence: string;
}

/**
 * The whole alert list in one sentence, for the tile on Today.
 *
 * IT NAMES THE WORST THING RATHER THAN COUNTING. "3 things to deal with today"
 * is a number; "Feed runs out Thursday" is the reason to tap. The count is
 * carried alongside for the badge.
 */
export function alertSummary(alerts: Alert[]): AlertSummary {
  const critical = alerts.filter((a) => a.level === 'CRITICAL').length;
  const attention = alerts.filter((a) => a.level === 'ATTENTION').length;
  const notice = alerts.filter((a) => a.level === 'NOTICE').length;

  const sorted = sortAlerts(alerts);
  const top = sorted[0];

  let sentence: string;
  if (!top) {
    sentence = 'Nothing needs you.';
  } else if (alerts.length === 1) {
    sentence = top.headline;
  } else {
    sentence = `${top.headline} — and ${alerts.length - 1} more.`;
  }

  return { total: alerts.length, critical, attention, notice, sentence };
}

/**
 * Alerts grouped by rule, worst group first.
 *
 * SIX ITEMS SHORT OF FEED IS ONE PROBLEM WITH THE FEED ORDER, not six problems.
 * The page shows the group, names the first few, and counts the rest — which is
 * both shorter and closer to how somebody would describe it out loud.
 */
export interface AlertGroup {
  rule: AlertRule;
  level: AlertLevel;
  alerts: Alert[];
}

export function groupAlerts(alerts: Alert[]): AlertGroup[] {
  const byRule = new Map<AlertRule, Alert[]>();
  for (const alert of sortAlerts(alerts)) {
    const held = byRule.get(alert.rule);
    if (held) held.push(alert);
    else byRule.set(alert.rule, [alert]);
  }

  return [...byRule.entries()]
    .map(([rule, list]) => ({
      rule,
      level: worst(list.map((a) => a.level)) ?? RULE_CATALOGUE[rule].level,
      alerts: list,
    }))
    .sort((a, b) => {
      const level = LEVEL_RANK[a.level] - LEVEL_RANK[b.level];
      if (level !== 0) return level;
      return b.alerts.length - a.alerts.length;
    });
}

/**
 * How long a condition has been standing, in whole days.
 *
 * Returns null rather than zero for an unknown start, so a caller can tell
 * "began today" from "we do not know when this began".
 */
export function daysStanding(alert: Alert, asOf: Date = new Date()): number | null {
  if (!alert.since) return null;
  const ms = asOf.getTime() - alert.since.getTime();
  return ms < 0 ? 0 : Math.floor(ms / 86_400_000);
}

export function standingSentence(alert: Alert, asOf: Date = new Date()): string {
  const days = daysStanding(alert, asOf);
  if (days === null) return '';
  if (days === 0) return 'Since today.';
  if (days === 1) return 'Standing since yesterday.';
  return `Standing for ${days} days.`;
}
