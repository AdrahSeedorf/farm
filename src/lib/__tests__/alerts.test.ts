import { describe, it, expect } from 'vitest';
import {
  ALERT_RULES,
  RULE_CATALOGUE,
  ALERT_LEVELS,
  LEVEL_LABELS,
  worst,
  buildAlert,
  mortalityLevel,
  thresholdsFrom,
  thresholdBasisSentence,
  DEFAULT_MORTALITY_THRESHOLDS,
  recordIsLate,
  DEFAULT_RECORD_DUE_HOUR,
  dedupe,
  sortAlerts,
  visibleTo,
  withoutAcknowledged,
  alertSummary,
  groupAlerts,
  daysStanding,
  standingSentence,
  type Alert,
} from '@/lib/alerts';
import type { Permission } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/rbac';

const DAY = 86_400_000;
const NOW = new Date('2026-09-07T09:00:00.000Z');

function alert(over: Partial<Alert> & Pick<Alert, 'rule'>): Alert {
  return buildAlert(over.rule, {
    subject: over.key?.split(':')[1] ?? 'x',
    headline: over.headline ?? 'Something',
    detail: over.detail ?? '',
    href: over.href ?? '/',
    siteId: over.siteId ?? null,
    since: over.since ?? null,
    level: over.level,
  });
}

describe('the rule catalogue', () => {
  it('defines every rule', () => {
    for (const rule of ALERT_RULES) {
      expect(RULE_CATALOGUE[rule]).toBeDefined();
    }
    expect(Object.keys(RULE_CATALOGUE).sort()).toEqual([...ALERT_RULES].sort());
  });

  // The permission on a rule is the only thing standing between a worker and a
  // supplier's prices. A typo here would be a silent leak, so it is asserted
  // against the real permission list rather than trusted to the type.
  it('names a permission that actually exists', () => {
    const real = new Set<string>(PERMISSIONS);
    for (const rule of ALERT_RULES) {
      expect(real.has(RULE_CATALOGUE[rule].permission)).toBe(true);
    }
  });

  it('explains itself in words a farmer could read', () => {
    for (const rule of ALERT_RULES) {
      const d = RULE_CATALOGUE[rule];
      expect(d.what.length).toBeGreaterThan(20);
      expect(d.why.length).toBeGreaterThan(20);
      expect(ALERT_LEVELS).toContain(d.level);
    }
  });

  // MONEY IS NOT AN OPERATIONAL SIGNAL. Anything a worker can be shown must not
  // depend on a finance permission, and vice versa — this catches a rule being
  // given `report:view` because it was convenient.
  it('never guards an operational rule behind a finance permission', () => {
    expect(RULE_CATALOGUE['mortality.high'].permission).toBe('flock:view');
    expect(RULE_CATALOGUE['incident.unattended'].permission).toBe('incident:view');
    expect(RULE_CATALOGUE['order.late'].permission).toBe('procurement:view');
  });

  it('labels levels by the response, not the severity', () => {
    expect(LEVEL_LABELS.CRITICAL).toMatch(/today/i);
    expect(LEVEL_LABELS.NOTICE).not.toMatch(/low/i);
  });

  it('ranks levels', () => {
    expect(worst(['NOTICE', 'CRITICAL', 'ATTENTION'])).toBe('CRITICAL');
    expect(worst(['NOTICE', 'ATTENTION'])).toBe('ATTENTION');
    expect(worst([])).toBeNull();
  });
});

describe('alert identity', () => {
  it('is stable across recomputation', () => {
    const a = buildAlert('stock.out', {
      subject: 'item-4',
      headline: 'Layer feed is finished',
      detail: '0 bags',
      href: '/inventory/item-4',
    });
    const b = buildAlert('stock.out', {
      subject: 'item-4',
      headline: 'Layer feed is finished',
      detail: '0 bags — recomputed an hour later',
      href: '/inventory/item-4',
    });
    expect(a.key).toBe(b.key);
    expect(a.key).toBe('stock.out:item-4');
  });

  it('takes its level from the catalogue unless told otherwise', () => {
    expect(alert({ rule: 'stock.out' }).level).toBe('CRITICAL');
    expect(alert({ rule: 'stock.out', level: 'ATTENTION' }).level).toBe('ATTENTION');
  });
});

// ---------------------------------------------------------------------------

describe('mortality', () => {
  const flock = { openingPopulation: 2000, priorDailyDeaths: [0, 1, 0, 0, 1, 0, 0] };

  it('says nothing when nothing died', () => {
    expect(mortalityLevel({ ...flock, deathsToday: 0 })).toBeNull();
  });

  it('says nothing about an ordinary day', () => {
    // 1 in 2,000 is 0.05% — inside both thresholds, and below the spike floor.
    expect(mortalityLevel({ ...flock, deathsToday: 1 })).toBeNull();
  });

  it('fires ATTENTION at the attention threshold', () => {
    // 2 in 2,000 = 0.1%, exactly the default attention figure.
    const verdict = mortalityLevel({ ...flock, deathsToday: 2 });
    expect(verdict?.level).toBe('ATTENTION');
    expect(verdict?.rule).toBe('mortality.high');
    expect(verdict?.sentence).toContain('0.1%');
  });

  it('fires CRITICAL at the critical threshold', () => {
    // 5 in 2,000 = 0.25%.
    const verdict = mortalityLevel({ ...flock, deathsToday: 5 });
    expect(verdict?.level).toBe('CRITICAL');
    expect(verdict?.sentence).toContain('0.25%');
  });

  // The binary-floating-point case that would otherwise make the identical
  // situation alert on one house and not the next.
  it('treats an exact threshold as met at every flock size', () => {
    for (const size of [1000, 1500, 2000, 2400, 3000, 7000]) {
      const deaths = (0.1 / 100) * size;
      if (!Number.isInteger(deaths)) continue;
      const verdict = mortalityLevel({
        openingPopulation: size,
        deathsToday: deaths,
        priorDailyDeaths: [],
      });
      expect(verdict, `flock of ${size}`).not.toBeNull();
    }
  });

  it('names the threshold it compared against, not a diagnosis', () => {
    const verdict = mortalityLevel({ ...flock, deathsToday: 5 });
    expect(verdict?.sentence).toMatch(/set for this stage/);
    expect(verdict?.sentence).not.toMatch(/disease|infection|newcastle|coccidiosis|treat/i);
  });

  describe('the spike rule', () => {
    it('catches a changed shape inside the threshold', () => {
      // Mean of the prior week is 0.286/day. Four deaths is 14× that, and 4 in
      // 2,000 is 0.2% — under the 0.25% critical line, so `high` does not fire.
      const verdict = mortalityLevel({ ...flock, deathsToday: 4 });
      expect(verdict?.rule).toBe('mortality.high'); // 0.2% ≥ 0.1% attention
      expect(verdict?.level).toBe('ATTENTION');
    });

    it('fires when the absolute rate is quiet but the multiple is not', () => {
      // A big flock: 3 in 20,000 is 0.015%, far under either threshold. The
      // prior week averaged 0.29/day, so three is ten times it — and three is
      // the floor, so it counts.
      const verdict = mortalityLevel({
        openingPopulation: 20_000,
        deathsToday: 3,
        priorDailyDeaths: [0, 1, 0, 0, 1, 0, 0],
      });
      expect(verdict?.rule).toBe('mortality.spike');
      expect(verdict?.level).toBe('ATTENTION');
      expect(verdict?.sentence).toContain('0.29');
    });

    // THE FLOOR IS THE WHOLE POINT. Without it this rule fires on a single dead
    // bird most weeks and gets switched off.
    it('does not call one dead bird a spike', () => {
      expect(
        mortalityLevel({
          openingPopulation: 20_000,
          deathsToday: 1,
          priorDailyDeaths: [0, 0, 0, 0, 0, 0, 1],
        }),
      ).toBeNull();
    });

    it('does not call two dead birds a spike either', () => {
      expect(
        mortalityLevel({
          openingPopulation: 20_000,
          deathsToday: 2,
          priorDailyDeaths: [0, 0, 0, 0, 0, 0, 0],
        }),
      ).toBeNull();
    });

    it('needs history to compare against', () => {
      expect(
        mortalityLevel({ openingPopulation: 20_000, deathsToday: 3, priorDailyDeaths: [] }),
      ).toBeNull();
    });

    // A day that is both is one day. Two rows on a phone for one event is how a
    // list of six real problems becomes a list of twelve.
    it('reports the worse of the two, never both', () => {
      const verdict = mortalityLevel({
        openingPopulation: 2000,
        deathsToday: 20, // 1%, well over critical, and a huge multiple
        priorDailyDeaths: [0, 0, 0, 0, 0, 0, 0],
      });
      expect(verdict?.rule).toBe('mortality.high');
      expect(verdict?.level).toBe('CRITICAL');
    });
  });

  describe('thresholds are data', () => {
    const farm = {
      mortalityAttentionPct: 0.1,
      mortalityCriticalPct: 0.25,
      mortalitySpikeMultiple: 3,
      mortalitySpikeFloorDeaths: 3,
    };

    it('prefers the stage figures', () => {
      const brooding = { mortalityAttentionPct: 0.35, mortalityCriticalPct: 0.7 };
      expect(thresholdsFrom(brooding, farm)).toEqual({
        attentionPct: 0.35,
        criticalPct: 0.7,
        spikeMultiple: 3,
        spikeFloorDeaths: 3,
      });
    });

    it('falls back field by field, not object by object', () => {
      const half = { mortalityAttentionPct: null, mortalityCriticalPct: 0.7 };
      const resolved = thresholdsFrom(half, farm);
      expect(resolved.criticalPct).toBe(0.7);
      expect(resolved.attentionPct).toBe(0.1);
    });

    it('falls back entirely when a production type has none', () => {
      expect(thresholdsFrom(null, farm).criticalPct).toBe(0.25);
    });

    // The same eight deaths: routine in brooding, an emergency in lay. A flat
    // figure gets one of the two wrong, which is why the numbers live on stages.
    it('reaches opposite verdicts for the same deaths at different stages', () => {
      const day = { deathsToday: 8, openingPopulation: 2000, priorDailyDeaths: [7, 8, 6] };
      const brooding = thresholdsFrom(
        { mortalityAttentionPct: 0.35, mortalityCriticalPct: 0.7 },
        farm,
      );
      const laying = thresholdsFrom(null, farm);

      expect(mortalityLevel(day, brooding)?.level).toBe('ATTENTION'); // 0.4%
      expect(mortalityLevel(day, laying)?.level).toBe('CRITICAL'); // 0.4% ≥ 0.25%
    });

    it('says whose number it was', () => {
      expect(
        thresholdBasisSentence({ name: 'Brooding', mortalityCriticalPct: 0.7 }),
      ).toContain('Brooding');
      expect(thresholdBasisSentence(null)).toMatch(/farm-wide/);
      expect(
        thresholdBasisSentence({ name: 'Laying', mortalityCriticalPct: null }),
      ).toMatch(/farm-wide/);
    });

    it('keeps sane defaults', () => {
      expect(DEFAULT_MORTALITY_THRESHOLDS.spikeFloorDeaths).toBeGreaterThanOrEqual(2);
      expect(DEFAULT_MORTALITY_THRESHOLDS.attentionPct).toBeLessThan(
        DEFAULT_MORTALITY_THRESHOLDS.criticalPct,
      );
    });
  });
});

// ---------------------------------------------------------------------------

describe('the daily record cut-off', () => {
  it('says nothing at first light', () => {
    expect(recordIsLate(6)).toBe(false);
    expect(recordIsLate(9)).toBe(false);
  });

  it('fires at the cut-off and after', () => {
    expect(recordIsLate(DEFAULT_RECORD_DUE_HOUR)).toBe(true);
    expect(recordIsLate(15)).toBe(true);
  });

  it('takes a farm-set hour', () => {
    expect(recordIsLate(8, 7)).toBe(true);
    expect(recordIsLate(8, 12)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('deduping', () => {
  it('collapses two rules about one subject to the worse', () => {
    const out = dedupe([
      buildAlert('stock.short', { subject: 'i1', headline: 'short', detail: '', href: '/' }),
      buildAlert('stock.out', { subject: 'i1', headline: 'out', detail: '', href: '/' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].rule).toBe('stock.out');
  });

  it('leaves different subjects alone', () => {
    const out = dedupe([
      buildAlert('stock.short', { subject: 'i1', headline: 'a', detail: '', href: '/' }),
      buildAlert('stock.short', { subject: 'i2', headline: 'b', detail: '', href: '/' }),
    ]);
    expect(out).toHaveLength(2);
  });

  // Different families about the same id are different problems: an item can be
  // short of stock and on a late order, and both are worth saying.
  it('does not collapse across families', () => {
    const out = dedupe([
      buildAlert('stock.short', { subject: 'i1', headline: 'a', detail: '', href: '/' }),
      buildAlert('order.late', { subject: 'i1', headline: 'b', detail: '', href: '/' }),
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('ordering', () => {
  it('puts worse first', () => {
    const out = sortAlerts([
      alert({ rule: 'task.overdue', key: 'task.overdue:t1' }),
      alert({ rule: 'stock.out', key: 'stock.out:i1' }),
      alert({ rule: 'health.unreviewed', key: 'health.unreviewed:f1' }),
    ]);
    expect(out.map((a) => a.level)).toEqual(['CRITICAL', 'ATTENTION', 'NOTICE']);
  });

  // The one that has been shouting since Tuesday is the one being ignored.
  it('breaks a tie on age, oldest first', () => {
    const old = buildAlert('stock.out', {
      subject: 'old',
      headline: 'old',
      detail: '',
      href: '/',
      since: new Date(NOW.getTime() - 4 * DAY),
    });
    const fresh = buildAlert('stock.out', {
      subject: 'fresh',
      headline: 'fresh',
      detail: '',
      href: '/',
      since: new Date(NOW.getTime() - 1 * DAY),
    });
    expect(sortAlerts([fresh, old]).map((a) => a.headline)).toEqual(['old', 'fresh']);
  });

  it('sorts an unknown start after dated ones rather than guessing', () => {
    const dated = buildAlert('stock.out', {
      subject: 'dated',
      headline: 'dated',
      detail: '',
      href: '/',
      since: new Date(NOW.getTime() - 1 * DAY),
    });
    const undated = buildAlert('stock.out', {
      subject: 'undated',
      headline: 'undated',
      detail: '',
      href: '/',
    });
    expect(sortAlerts([undated, dated]).map((a) => a.headline)).toEqual(['dated', 'undated']);
  });
});

// ---------------------------------------------------------------------------

describe('who may see what', () => {
  const worker = new Set<Permission>([
    'dailyRecord:view',
    'flock:view',
    'task:view',
    'incident:view',
  ]);

  const all: Alert[] = ALERT_RULES.map((rule) =>
    buildAlert(rule, { subject: 's', headline: rule, detail: '', href: '/' }),
  );

  it('drops what the reader does not hold', () => {
    const seen = visibleTo(all, worker).map((a) => a.rule);
    expect(seen).toContain('mortality.high');
    expect(seen).not.toContain('order.late');
    expect(seen).not.toContain('stock.out');
    expect(seen).not.toContain('health.withdrawal');
  });

  it('shows everything to a permission set that holds everything', () => {
    const owner = new Set<Permission>(PERMISSIONS);
    expect(visibleTo(all, owner)).toHaveLength(all.length);
  });

  it('shows nothing to a reader holding nothing', () => {
    expect(visibleTo(all, new Set<Permission>())).toHaveLength(0);
  });
});

describe('acknowledgement', () => {
  const a = buildAlert('task.overdue', { subject: 't1', headline: 'x', detail: '', href: '/' });

  it('hides an alert somebody has parked', () => {
    const until = new Date(NOW.getTime() + 2 * DAY);
    expect(withoutAcknowledged([a], new Map([[a.key, until]]), NOW)).toHaveLength(0);
  });

  it('brings it back when the parking expires', () => {
    const until = new Date(NOW.getTime() - 1);
    expect(withoutAcknowledged([a], new Map([[a.key, until]]), NOW)).toHaveLength(1);
  });

  it('treats an open-ended acknowledgement as permanent', () => {
    expect(withoutAcknowledged([a], new Map([[a.key, null]]), NOW)).toHaveLength(0);
  });

  it('does not confuse one alert with another', () => {
    expect(withoutAcknowledged([a], new Map([['task.overdue:t2', null]]), NOW)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('summarising', () => {
  it('says so plainly when there is nothing', () => {
    const s = alertSummary([]);
    expect(s.total).toBe(0);
    expect(s.sentence).toBe('Nothing needs you.');
  });

  // A count is not a reason to tap. The worst thing, named, is.
  it('names the worst thing rather than counting', () => {
    const s = alertSummary([
      buildAlert('task.overdue', { subject: 't', headline: 'A task is late', detail: '', href: '/' }),
      buildAlert('stock.out', {
        subject: 'i',
        headline: 'Layer feed is finished',
        detail: '',
        href: '/',
      }),
    ]);
    expect(s.sentence).toContain('Layer feed is finished');
    expect(s.sentence).toContain('1 more');
    expect(s.critical).toBe(1);
    expect(s.attention).toBe(1);
  });

  it('does not say "and 0 more"', () => {
    const s = alertSummary([
      buildAlert('stock.out', { subject: 'i', headline: 'Feed is finished', detail: '', href: '/' }),
    ]);
    expect(s.sentence).toBe('Feed is finished');
  });
});

describe('grouping', () => {
  it('turns six short items into one problem with the feed order', () => {
    const short = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) =>
      buildAlert('stock.short', { subject: id, headline: id, detail: '', href: '/' }),
    );
    const groups = groupAlerts([
      ...short,
      buildAlert('incident.unattended', { subject: 'i', headline: 'i', detail: '', href: '/' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].rule).toBe('incident.unattended'); // critical outranks six
    expect(groups[1].alerts).toHaveLength(6);
  });

  it('orders equal levels by how many are in the group', () => {
    const groups = groupAlerts([
      buildAlert('task.overdue', { subject: 't1', headline: 'a', detail: '', href: '/' }),
      buildAlert('order.late', { subject: 'o1', headline: 'b', detail: '', href: '/' }),
      buildAlert('order.late', { subject: 'o2', headline: 'c', detail: '', href: '/' }),
    ]);
    expect(groups[0].rule).toBe('order.late');
  });
});

describe('how long it has been standing', () => {
  it('does not guess an unknown start', () => {
    expect(daysStanding(alert({ rule: 'stock.out' }), NOW)).toBeNull();
    expect(standingSentence(alert({ rule: 'stock.out' }), NOW)).toBe('');
  });

  it('counts whole days', () => {
    const a = buildAlert('stock.out', {
      subject: 'i',
      headline: 'x',
      detail: '',
      href: '/',
      since: new Date(NOW.getTime() - 3 * DAY),
    });
    expect(daysStanding(a, NOW)).toBe(3);
    expect(standingSentence(a, NOW)).toBe('Standing for 3 days.');
  });

  it('reads naturally at one and zero', () => {
    const yesterday = buildAlert('stock.out', {
      subject: 'i',
      headline: 'x',
      detail: '',
      href: '/',
      since: new Date(NOW.getTime() - 1 * DAY),
    });
    const today = buildAlert('stock.out', {
      subject: 'j',
      headline: 'x',
      detail: '',
      href: '/',
      since: new Date(NOW.getTime() - 3600_000),
    });
    expect(standingSentence(yesterday, NOW)).toBe('Standing since yesterday.');
    expect(standingSentence(today, NOW)).toBe('Since today.');
  });

  it('does not report a negative age for a clock skew', () => {
    const future = buildAlert('stock.out', {
      subject: 'i',
      headline: 'x',
      detail: '',
      href: '/',
      since: new Date(NOW.getTime() + DAY),
    });
    expect(daysStanding(future, NOW)).toBe(0);
  });
});
