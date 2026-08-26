import { describe, it, expect } from 'vitest';
import {
  usageRate,
  runsOutOn,
  coverUrgency,
  coverSentence,
  daysInclusive,
  USAGE_MOVEMENTS,
  DEFAULT_LEAD_TIME_DAYS,
  DEFAULT_WINDOW_DAYS,
} from '../stock-cover';
import { daysOfCover } from '../stock-ledger';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const asOf = d('2026-08-26');

describe('counting days', () => {
  it('counts both ends', () => {
    expect(daysInclusive(d('2026-08-26'), d('2026-08-26'))).toBe(1);
    expect(daysInclusive(d('2026-08-20'), d('2026-08-26'))).toBe(7);
  });

  it('ignores the time of day, since dates here are calendar days', () => {
    expect(daysInclusive(new Date('2026-08-20T23:59:00Z'), new Date('2026-08-26T00:01:00Z'))).toBe(7);
  });
});

describe('the rate an item is being used at', () => {
  it('divides the window total by the days observed', () => {
    // 350 kg over a full seven-day window.
    const r = usageRate(350, d('2026-01-01'), asOf);
    expect(r).not.toBeNull();
    expect(r!.perDay).toBe(50);
    expect(r!.observedDays).toBe(7);
  });

  it('divides by CALENDAR days, not by days something was issued', () => {
    // A farm that draws feed on five mornings still has to get through Sunday.
    const r = usageRate(350, d('2026-01-01'), asOf);
    expect(r!.perDay).toBe(50); // not 350 / 5
  });

  it('shortens the window for an item with less history than that', () => {
    // First movement four days ago: average over four days, not seven.
    const r = usageRate(200, d('2026-08-23'), asOf);
    expect(r!.observedDays).toBe(4);
    expect(r!.perDay).toBe(50);
  });

  it('REFUSES to average one or two days of history', () => {
    // "We used 400 kg yesterday" must not become "400 kg a day", which would
    // report three weeks of feed as holding out for one.
    expect(usageRate(400, d('2026-08-26'), asOf)).toBeNull();
    expect(usageRate(400, d('2026-08-25'), asOf)).toBeNull();
    expect(usageRate(400, d('2026-08-24'), asOf)).not.toBeNull();
  });

  it('says nothing at all about an item that has never moved', () => {
    expect(usageRate(0, null, asOf)).toBeNull();
  });

  it('reports a rate of zero as a real answer, not as unknown', () => {
    // Sitting unused is different from not knowing, and the two read differently
    // on a dashboard.
    const r = usageRate(0, d('2026-01-01'), asOf);
    expect(r).not.toBeNull();
    expect(r!.perDay).toBe(0);
  });

  it('ignores a first-movement date in the future rather than dividing by zero', () => {
    expect(usageRate(100, d('2026-09-01'), asOf)).toBeNull();
  });
});

describe('what counts as use', () => {
  it('counts issues, consumption and sales', () => {
    expect(USAGE_MOVEMENTS).toContain('ISSUE');
    expect(USAGE_MOVEMENTS).toContain('CONSUMPTION');
    expect(USAGE_MOVEMENTS).toContain('SALE');
  });

  it('EXCLUDES damage and expiry, which are losses rather than a rate', () => {
    // A flooded store would otherwise inflate the daily rate and then report a
    // comfortable amount of feed as nearly exhausted.
    expect(USAGE_MOVEMENTS).not.toContain('DAMAGE');
    expect(USAGE_MOVEMENTS).not.toContain('EXPIRY');
  });
});

describe('days of cover and the date it runs out', () => {
  it('turns stock and a rate into a number of days', () => {
    expect(daysOfCover(480, 50)).toBeCloseTo(9.6, 2);
  });

  it('turns those days into a date', () => {
    expect(runsOutOn(asOf, 9.6)).toEqual(d('2026-09-04'));
  });

  it('gives no date when there is no rate', () => {
    expect(runsOutOn(asOf, null)).toBeNull();
  });

  it('gives today when the stock is already gone', () => {
    expect(runsOutOn(asOf, 0)).toEqual(asOf);
  });
});

describe('how worried to be, measured against delivery time', () => {
  it('is critical when stock runs out before an order could arrive', () => {
    // Four days of feed with a seven-day supplier is an emergency.
    expect(coverUrgency(4, 7)).toBe('CRITICAL');
  });

  it('and the SAME four days is fine with a next-day supplier', () => {
    // This is the whole reason the threshold is not a fixed number of days.
    expect(coverUrgency(4, 1)).toBe('OK');
  });

  it('is low inside twice the lead time — the window to start ordering', () => {
    expect(coverUrgency(10, 7)).toBe('LOW');
    expect(coverUrgency(15, 7)).toBe('OK');
  });

  it('is out at zero or below', () => {
    expect(coverUrgency(0, 7)).toBe('OUT');
    expect(coverUrgency(-3, 7)).toBe('OUT');
  });

  it('is unknown when there is no figure, not falsely fine', () => {
    expect(coverUrgency(null, 7)).toBe('UNKNOWN');
    expect(coverUrgency(Infinity, 7)).toBe('UNKNOWN');
  });

  it('defaults to a week of lead time', () => {
    expect(DEFAULT_LEAD_TIME_DAYS).toBe(7);
    expect(coverUrgency(4)).toBe('CRITICAL');
  });
});

describe('the sentence a storekeeper reads', () => {
  const rate = usageRate(350, d('2026-01-01'), asOf)!;

  it('says how long, and on what basis', () => {
    expect(coverSentence(9.6, rate)).toBe('About 9.6 days left at the last 7 days’ rate.');
  });

  it('says plainly when a delivery would not arrive in time', () => {
    expect(coverSentence(4, rate)).toMatch(/less than the 7 days a delivery takes/);
  });

  it('admits when there is not enough history rather than inventing a figure', () => {
    expect(coverSentence(null, null)).toMatch(/Not enough history/);
  });

  it('distinguishes an unused item from an unknown one', () => {
    const idle = usageRate(0, d('2026-01-01'), asOf)!;
    expect(coverSentence(null, idle)).toMatch(/Nothing issued in the last week/);
  });
});

describe('the window is a week, deliberately', () => {
  it('defaults to seven days', () => {
    expect(DEFAULT_WINDOW_DAYS).toBe(7);
  });

  it('tracks a growing flock far better than a month would', () => {
    /**
     * A flock's intake climbs steeply. Suppose the last four weeks used
     * 100, 200, 300 and 400 kg per week — this week's real rate is ~57 kg/day.
     * A 28-day average says ~36 kg/day, which on 480 kg of feed reports
     * 13 days of cover when the truth is 8. That gap is a farm running out of
     * feed on a Sunday.
     */
    const weekRate = usageRate(400, d('2026-01-01'), asOf, 7)!.perDay;
    const monthRate = usageRate(1000, d('2026-01-01'), asOf, 28)!.perDay;

    expect(Math.round(weekRate)).toBe(57);
    expect(Math.round(monthRate)).toBe(36);
    expect(daysOfCover(480, weekRate)!).toBeLessThan(daysOfCover(480, monthRate)!);
  });
});
