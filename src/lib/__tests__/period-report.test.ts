import { describe, it, expect } from 'vitest';
import {
  startOfWeek,
  periodFor,
  daysIn,
  periodSentence,
  isInFuture,
  reconcile,
  stockTakeNote,
  derive,
  headline,
  agreedSentence,
  lossSentence,
  EMPTY_FIGURES,
  BASIS,
  PERIOD_LABELS,
  type PeriodFigures,
} from '@/lib/period-report';
import { fromCedis, formatGHS } from '@/lib/money';

// A Friday.
const FRIDAY = new Date('2026-09-11T00:00:00.000Z');
const day = (d: Date) => d.toISOString().slice(0, 10);

function figures(over: Partial<PeriodFigures> = {}): PeriodFigures {
  return { ...EMPTY_FIGURES, ...over };
}

describe('the period', () => {
  /**
   * A farm week in Ghana is the one that started on Monday. A report quietly
   * using Sunday would put one day's eggs in the wrong week every single time.
   */
  it('WEEKS RUN MONDAY TO SUNDAY', () => {
    expect(day(startOfWeek(FRIDAY))).toBe('2026-09-07');
    // A Monday is its own start.
    expect(day(startOfWeek(new Date('2026-09-07T00:00:00.000Z')))).toBe('2026-09-07');
    // A Sunday belongs to the week that began six days earlier.
    expect(day(startOfWeek(new Date('2026-09-13T00:00:00.000Z')))).toBe('2026-09-07');
  });

  it('this week runs from Monday to today, not to Sunday', () => {
    const period = periodFor('THIS_WEEK', FRIDAY);
    expect(day(period.from)).toBe('2026-09-07');
    expect(day(period.to)).toBe('2026-09-11');
    expect(daysIn(period)).toBe(5);
  });

  it('last week is a whole week', () => {
    const period = periodFor('LAST_WEEK', FRIDAY);
    expect(day(period.from)).toBe('2026-08-31');
    expect(day(period.to)).toBe('2026-09-06');
    expect(daysIn(period)).toBe(7);
  });

  it('this month starts on the first', () => {
    const period = periodFor('THIS_MONTH', FRIDAY);
    expect(day(period.from)).toBe('2026-09-01');
    expect(day(period.to)).toBe('2026-09-11');
  });

  it('last month is the whole of it, including a short one', () => {
    const march = periodFor('LAST_MONTH', new Date('2026-03-15T00:00:00.000Z'));
    expect(day(march.from)).toBe('2026-02-01');
    expect(day(march.to)).toBe('2026-02-28');
    expect(daysIn(march)).toBe(28);
  });

  it('and crosses a year end without help', () => {
    const january = periodFor('LAST_MONTH', new Date('2026-01-15T00:00:00.000Z'));
    expect(day(january.from)).toBe('2025-12-01');
    expect(day(january.to)).toBe('2025-12-31');
  });

  /** Somebody typing the dates the wrong way round meant it, just backwards. */
  it('BACKWARDS DATES ARE SWAPPED, NOT REFUSED', () => {
    const period = periodFor('CUSTOM', FRIDAY, {
      from: new Date('2026-09-10T00:00:00.000Z'),
      to: new Date('2026-09-01T00:00:00.000Z'),
    });
    expect(day(period.from)).toBe('2026-09-01');
    expect(day(period.to)).toBe('2026-09-10');
  });

  it('says the period in words, and knows when it is one day', () => {
    expect(periodSentence(periodFor('THIS_WEEK', FRIDAY))).toBe('2026-09-07 to 2026-09-11 — 5 days.');
    const oneDay = periodFor('CUSTOM', FRIDAY, { from: FRIDAY, to: FRIDAY });
    expect(periodSentence(oneDay)).toBe('2026-09-11 — one day.');
  });

  it('knows a period that has not happened yet', () => {
    const future = periodFor('CUSTOM', FRIDAY, {
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-10-07T00:00:00.000Z'),
    });
    expect(isInFuture(future, FRIDAY)).toBe(true);
    expect(isInFuture(periodFor('THIS_WEEK', FRIDAY), FRIDAY)).toBe(false);
  });

  it('labels every period in words a farmer would use', () => {
    expect(PERIOD_LABELS.THIS_WEEK).toBe('This week');
    expect(PERIOD_LABELS.CUSTOM).toMatch(/dates/i);
  });
});

describe('the reconciliation — the point of the report', () => {
  /**
   * THE FIRST VERSION OF THIS CHECK COULD NEVER FAIL. It compared what went into
   * the store against what came out and the change in the store — all three from
   * the stock ledger, so they agreed by construction. These tests are on the
   * check that replaced it, which compares two ledgers written by different
   * steps: what the houses counted, and what the store received.
   */
  it('says so when everything counted reached the store', () => {
    const result = reconcile(figures({ collected: 600, collectedHeld: 600, intoStore: 600 }));
    expect(result.verdict).toBe('AGREES');
    expect(result.gap).toBe(0);
    expect(result.sentence).toMatch(/everything counted in the houses reached the store/i);
  });

  it('CATCHES EGGS THAT WERE COUNTED AND NEVER BECAME STOCK', () => {
    const result = reconcile(figures({ collected: 660, collectedHeld: 660, intoStore: 600 }));
    expect(result.verdict).toBe('DISAGREES');
    expect(result.gap).toBe(60);
    expect(result.sentence).toMatch(/60 were counted in the houses and never reached the store/i);
    expect(result.sentence).toMatch(/no store was set to receive produce/i);
  });

  it('and names a different problem when the store received MORE', () => {
    const result = reconcile(figures({ collected: 600, collectedHeld: 600, intoStore: 640 }));
    expect(result.verdict).toBe('DISAGREES');
    expect(result.gap).toBe(-40);
    expect(result.sentence).toMatch(/received 40 more/i);
    expect(result.sentence).toMatch(/no collection accounts for/i);
  });

  /**
   * Cracked and floor eggs are collected and held by nobody. Counting them as a
   * gap would report one every day and teach the farm to ignore the real one.
   */
  it('GRADES NOBODY HOLDS AS STOCK ARE EXPLAINED, NOT REPORTED AS A GAP', () => {
    const result = reconcile(figures({ collected: 640, collectedHeld: 600, intoStore: 600 }));
    expect(result.verdict).toBe('AGREES');
    expect(result.gap).toBe(0);
    expect(result.notHeldAsStock).toBe(40);
  });

  it('A GAP OF ONE EGG IS STILL A GAP', () => {
    const result = reconcile(figures({ collected: 600, collectedHeld: 600, intoStore: 599 }));
    expect(result.verdict).toBe('DISAGREES');
    expect(result.gap).toBe(1);
  });

  it('says there is nothing to check rather than claiming agreement', () => {
    const result = reconcile(figures());
    expect(result.verdict).toBe('NOTHING_TO_CHECK');
    expect(result.sentence).toMatch(/nothing to check/i);
  });

  it('reports both sides of the sum so somebody can follow it', () => {
    const result = reconcile(figures({ collected: 660, collectedHeld: 660, intoStore: 600 }));
    expect(result.countedInHouses).toBe(660);
    expect(result.reachedStore).toBe(600);
  });

  /**
   * THE HONEST LIMIT. A farm reading "the collections and the store agree" as
   * "the eggs are all there" would be reading something this system cannot know.
   */
  it('AND THE REPORT SAYS WHAT IT CANNOT TELL ANYBODY', () => {
    const note = stockTakeNote();
    expect(note).toMatch(/nobody has counted the store/i);
    expect(note).toMatch(/records agreeing with the records/i);
    expect(note).toMatch(/stock take/i);
    expect(note).toMatch(/not built yet/i);
  });
});

describe('what the figures mean', () => {
  const base = figures({
    collected: 4200,
    saleable: 4000,
    dispatched: 3000,
    openingBirds: 1000,
    closingBirds: 990,
    deaths: 8,
    culls: 2,
    feedKg: 770,
    feedPesewas: fromCedis(3465),
  });

  it('hen-day is eggs a day against the birds actually there', () => {
    // 4200 over 7 days = 600 a day; average birds (1000+990)/2 = 995 → 60.3%
    expect(derive(base, 7).henDayPct).toBe(60.3);
  });

  it('saleable rate is a share of what was collected', () => {
    expect(derive(base, 7).saleablePct).toBe(95.2);
  });

  it('loss is against the birds there at the start', () => {
    expect(derive(base, 7).lossPct).toBe(1);
    expect(lossSentence(base, derive(base, 7))).toBe('8 died, 2 culled — 1% of the birds there at the start.');
  });

  it('and says so plainly when none were lost', () => {
    const none = figures({ openingBirds: 1000, closingBirds: 1000 });
    expect(lossSentence(none, derive(none, 7))).toBe('No birds were lost in this period.');
  });

  it('feed intake is grams per bird per day', () => {
    // 770 kg = 770,000 g, over 995 average birds and 7 days = 110.6 g, shown whole.
    expect(derive(base, 7).feedPerBirdGrams).toBe(111);
  });

  /**
   * FEED COST PER EGG IS NOT A COST PER EGG. Feed only — no labour, no pullets,
   * no depreciation. A farm reading it as the full cost will price below cost.
   */
  it('FEED COST PER EGG IS FEED ONLY', () => {
    // GHS 3,465 over 4200 eggs = 82.5 pesewas, rounded to the pesewa.
    expect(formatGHS(derive(base, 7).feedCostPerEgg!)).toBe('GHS 0.83');
  });

  it('what was collected and not sold is a number, not a failure', () => {
    expect(derive(base, 7).unsold).toBe(1200);
  });

  it('nothing is invented before there are birds or eggs', () => {
    const nothing = derive(figures(), 7);
    expect(nothing.henDayPct).toBeNull();
    expect(nothing.saleablePct).toBeNull();
    expect(nothing.lossPct).toBeNull();
    expect(nothing.feedPerBirdGrams).toBeNull();
    expect(nothing.feedCostPerEgg).toBeNull();
  });
});

describe('reading it back', () => {
  it('the headline leads with what was collected', () => {
    const f = figures({ collected: 4200, dispatched: 3000, openingBirds: 1000, closingBirds: 1000 });
    expect(headline(f, derive(f, 7))).toMatch(/^4200 collected · 3000 sold/);
  });

  it('and says plainly when nothing happened', () => {
    expect(headline(EMPTY_FIGURES, derive(EMPTY_FIGURES, 7))).toBe(
      'Nothing was collected and nothing went out in this period.',
    );
  });

  /**
   * THE SAME RULE AS THE BUYER PAGE. A farm looking at a figure called "sales"
   * treats it as takings.
   */
  it('WHAT WAS AGREED IS NEVER CALLED REVENUE OR TAKINGS', () => {
    const f = figures({ loads: 3, agreedPesewas: fromCedis(1350) });
    const sentence = agreedSentence(f);
    expect(sentence).toContain('GHS 1,350.00');
    expect(sentence).toMatch(/not what has been received/i);
    expect(sentence.toLowerCase()).not.toContain('revenue');
    expect(sentence.toLowerCase()).not.toContain('income');
    expect(sentence.toLowerCase()).not.toContain('takings');
  });

  it('says nothing went out rather than showing a zero', () => {
    expect(agreedSentence(EMPTY_FIGURES)).toBe('Nothing went out in this period.');
  });

  /** A figure on a report with no stated basis is one nobody can defend. */
  it('EVERY FIGURE HAS A STATED BASIS', () => {
    for (const key of ['collected', 'saleable', 'intoStore', 'outOfStore', 'stock', 'dispatched', 'agreed', 'birds', 'feed']) {
      expect(BASIS[key], key).toBeTruthy();
      expect(BASIS[key].length, key).toBeGreaterThan(20);
    }
    expect(BASIS.stock).toMatch(/no stored total/i);
  });
});
