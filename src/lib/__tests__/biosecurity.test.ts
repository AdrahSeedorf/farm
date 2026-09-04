import { describe, it, expect } from 'vitest';
import {
  hoursBetween,
  downtimeFor,
  downtimeSentence,
  describeHours,
  daysSince,
  cleaningStatus,
  cleaningSentence,
  summariseChecks,
  checkSentence,
  CLEANING_GRACE_DAYS,
  type CheckLine,
} from '../biosecurity';

const t = (iso: string) => new Date(iso);
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('downtime between poultry farms', () => {
  const arrived = t('2026-09-04T08:00:00.000Z');

  it('measures the hours since the declared contact', () => {
    const dt = downtimeFor(t('2026-09-02T08:00:00.000Z'), arrived, 48);
    expect(dt.hoursSinceContact).toBe(48);
    expect(dt.status).toBe('PAST_DOWNTIME');
  });

  it('says how long is still to run', () => {
    const dt = downtimeFor(t('2026-09-03T20:00:00.000Z'), arrived, 48);
    expect(dt.status).toBe('WITHIN_DOWNTIME');
    expect(dt.hoursRemaining).toBe(36);
    expect(dt.clearsAt?.toISOString()).toBe('2026-09-05T20:00:00.000Z');
  });

  it('clears exactly on the hour the rule is met', () => {
    expect(downtimeFor(t('2026-09-02T08:00:00.000Z'), arrived, 48).status).toBe(
      'PAST_DOWNTIME',
    );
    expect(downtimeFor(t('2026-09-02T08:00:01.000Z'), arrived, 48).status).toBe(
      'WITHIN_DOWNTIME',
    );
  });

  it('SHIPS NO DOWNTIME RULE OF ITS OWN', () => {
    // How long a farm asks for is a judgement about local disease pressure, the
    // season and who is visiting. It belongs to the farm and its vet.
    const dt = downtimeFor(t('2026-09-02T08:00:00.000Z'), arrived, null);
    expect(dt.status).toBe('NO_RULE');
    expect(dt.clearsAt).toBeNull();
  });

  it('still reports the elapsed time when there is no rule', () => {
    // Reporting a fact is not the same as passing a judgement.
    expect(downtimeFor(t('2026-09-02T08:00:00.000Z'), arrived, null).hoursSinceContact).toBe(48);
  });

  it('AN UNDECLARED CONTACT IS NOT A CLEARED ONE', () => {
    // A visitor who did not answer is an unknown. A visitor who answered and
    // cleared the rule is a known quantity. Collapsing the two is how an
    // unrecorded risk becomes an invisible one.
    const dt = downtimeFor(null, arrived, 48);
    expect(dt.status).toBe('NOT_DECLARED');
    expect(dt.status).not.toBe('PAST_DOWNTIME');
    expect(dt.hoursSinceContact).toBeNull();
  });

  it('treats a zero or negative rule as no rule at all', () => {
    expect(downtimeFor(t('2026-09-02T08:00:00.000Z'), arrived, 0).status).toBe('NO_RULE');
    expect(downtimeFor(t('2026-09-02T08:00:00.000Z'), arrived, -12).status).toBe('NO_RULE');
  });

  it('counts hours between two moments', () => {
    expect(hoursBetween(t('2026-09-04T08:00:00.000Z'), t('2026-09-04T20:00:00.000Z'))).toBe(12);
  });
});

describe('what the visitor screen says', () => {
  const arrived = t('2026-09-04T08:00:00.000Z');

  it('NEVER TELLS ANYONE WHETHER THEY MAY ENTER', () => {
    // The software reports hours and rules. Who walks into a poultry house is
    // the farm manager's decision.
    const inside = downtimeSentence(downtimeFor(t('2026-09-03T20:00:00.000Z'), arrived, 48), 48);
    expect(inside).not.toMatch(/should not|do not let|refuse|denied|not allowed/i);
    expect(inside).toMatch(/36 hours still to run/);
  });

  it('states the fact when the rule is met', () => {
    const past = downtimeSentence(downtimeFor(t('2026-09-01T08:00:00.000Z'), arrived, 48), 48);
    expect(past).toMatch(/past this farm's 48-hour downtime/);
  });

  it('says plainly that nothing can be measured without a rule', () => {
    const none = downtimeSentence(downtimeFor(t('2026-09-02T08:00:00.000Z'), arrived, null), null);
    expect(none).toMatch(/no downtime rule is set/i);
    expect(none).toMatch(/nothing here to measure that against|nothing to measure that against/i);
  });

  it('says plainly that nothing was declared', () => {
    const undeclared = downtimeSentence(downtimeFor(null, arrived, 48), 48);
    expect(undeclared).toMatch(/did not say/i);
    expect(undeclared).toMatch(/nothing here can tell/i);
  });

  it('says hours the way a person would', () => {
    expect(describeHours(0.5)).toBe('30 minutes');
    expect(describeHours(1)).toBe('1 hour');
    expect(describeHours(36)).toBe('36 hours');
    expect(describeHours(72)).toBe('3 days');
  });
});

describe('cleaning and disinfection', () => {
  const today = d('2026-09-04');

  it('counts whole days since the last clean', () => {
    expect(daysSince(d('2026-08-28'), today)).toBe(7);
    expect(daysSince(today, today)).toBe(0);
  });

  it('is fine inside the interval', () => {
    const r = cleaningStatus(d('2026-09-01'), 7, today);
    expect(r.status).toBe('OK');
    expect(r.days).toBe(3);
  });

  it('reads as due, not overdue, inside the grace band', () => {
    // A weekly clean done on the eighth day is a farm running slightly late,
    // not a farm in trouble — and a system that shouts on day eight is ignored
    // by day ten.
    expect(cleaningStatus(d('2026-08-28'), 7, today).status).toBe('DUE');
    expect(CLEANING_GRACE_DAYS).toBe(2);
  });

  it('reads as overdue past the grace band', () => {
    const r = cleaningStatus(d('2026-08-25'), 7, today);
    expect(r.status).toBe('OVERDUE');
    expect(r.overdueBy).toBe(3);
  });

  it('says NEVER rather than overdue when nothing was ever recorded', () => {
    expect(cleaningStatus(null, 7, today).status).toBe('NEVER');
  });

  it('UNTRACKED IS NOT THE SAME AS OK', () => {
    // A house nobody has set an interval for is not up to date. It is a house
    // nobody is measuring, and it must not hide among the ones that are fine.
    const r = cleaningStatus(d('2026-01-01'), null, today);
    expect(r.status).toBe('UNTRACKED');
    expect(r.status).not.toBe('OK');
    expect(r.days).toBe(246);
  });

  it('writes each state as a sentence', () => {
    expect(cleaningSentence(cleaningStatus(d('2026-09-01'), 7, today), 7)).toMatch(/inside the 7-day/);
    expect(cleaningSentence(cleaningStatus(d('2026-08-25'), 7, today), 7)).toMatch(/overdue by 3 days/i);
    expect(cleaningSentence(cleaningStatus(null, 7, today), 7)).toMatch(/nothing recorded yet/i);
    expect(cleaningSentence(cleaningStatus(d('2026-01-01'), null, today), null)).toMatch(
      /no interval is set/i,
    );
  });
});

describe('an inspection', () => {
  const lines: CheckLine[] = [
    { key: 'footbath', label: 'Footbath charged', result: 'PASS' },
    { key: 'perimeter', label: 'Perimeter intact', result: 'PASS' },
    { key: 'rodents', label: 'No rodent activity', result: 'FAIL', note: 'Droppings by feed store' },
    { key: 'wild_birds', label: 'Wild birds excluded', result: 'NOT_CHECKED' },
    { key: 'vehicle_dip', label: 'Vehicle dip', result: 'NOT_APPLICABLE' },
  ];

  it('counts each kind of answer', () => {
    const s = summariseChecks(lines);
    expect(s.passed).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.notChecked).toBe(1);
    expect(s.notApplicable).toBe(1);
  });

  it('scores against what was actually judged, not the whole list', () => {
    // 2 of 3 judged, not 2 of 5 — the skipped and inapplicable lines are not
    // failures and must not drag the figure down as though they were.
    expect(summariseChecks(lines).scorePct).toBeCloseTo(66.67, 1);
  });

  it('keeps the failures themselves, with their notes', () => {
    const s = summariseChecks(lines);
    expect(s.failures).toHaveLength(1);
    expect(s.failures[0].note).toMatch(/feed store/);
  });

  it('REPORTS NOTHING RATHER THAN ZERO when nothing was checked', () => {
    // A score of 0% for an inspection nobody carried out reads as a
    // catastrophic result rather than an absent one, and somebody would act.
    const blank = summariseChecks([
      { key: 'a', label: 'A', result: 'NOT_CHECKED' },
      { key: 'b', label: 'B', result: 'NOT_CHECKED' },
    ]);
    expect(blank.scorePct).toBeNull();
    expect(checkSentence(blank)).toMatch(/nothing was checked/i);
  });

  it('does not fold a skipped line into a pass', () => {
    const s = summariseChecks(lines);
    expect(s.passed).not.toBe(3);
    expect(checkSentence(s)).toMatch(/1 not checked/);
  });

  it('writes the result as a sentence', () => {
    expect(checkSentence(summariseChecks(lines))).toBe('2 passed, 1 failed, 1 not checked.');
  });

  it('handles an empty list without dividing by nothing', () => {
    expect(summariseChecks([]).scorePct).toBeNull();
  });
});
