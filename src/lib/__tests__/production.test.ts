import { describe, it, expect } from 'vitest';
import {
  totalOf,
  collectionTotal,
  dayTotal,
  gradeTotals,
  saleableOf,
  rejectedOf,
  saleableRate,
  reconcile,
  henDaySeries,
  weeklyLay,
  cumulativeOutput,
  henHoused,
  layMilestones,
  standardHenDayAt,
  layStandardFrom,
  henDayVsStandardPoints,
  missingDays,
  type Collection,
  type DayOfLay,
  type Grade,
  type OutputLine,
} from '../production';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * A grade list as a farm would configure it. Sizes first, then the two things
 * that cannot be sold — which is the order they are read in, not the order of
 * their size.
 */
const grades: Grade[] = [
  { key: 'xl', name: 'Extra large', isSaleable: true, sortOrder: 1 },
  { key: 'large', name: 'Large', isSaleable: true, sortOrder: 2 },
  { key: 'medium', name: 'Medium', isSaleable: true, sortOrder: 3 },
  { key: 'cracked', name: 'Cracked', isSaleable: false, sortOrder: 4 },
  { key: 'dirty', name: 'Dirty', isSaleable: false, sortOrder: 5 },
];

/** One morning's grading: 1,000 eggs, 40 of them unsaleable. */
const lines: OutputLine[] = [
  { gradeKey: 'medium', quantity: 300 },
  { gradeKey: 'large', quantity: 560 },
  { gradeKey: 'xl', quantity: 100 },
  { gradeKey: 'cracked', quantity: 30 },
  { gradeKey: 'dirty', quantity: 10 },
];

describe('what came out', () => {
  it('adds up the lines', () => {
    expect(totalOf(lines)).toBe(1000);
    expect(totalOf([])).toBe(0);
  });

  it('prefers the count taken in the house to the count taken at the bench', () => {
    const collection: Collection = { sequence: 1, countedQuantity: 1010, lines };
    expect(collectionTotal(collection)).toBe(1010);
  });

  it('falls back to the graded lines when nothing was counted separately', () => {
    expect(collectionTotal({ sequence: 1, countedQuantity: null, lines })).toBe(1000);
  });

  it('sums a day out of its collections rather than storing one total', () => {
    const day: Collection[] = [
      { sequence: 1, countedQuantity: 620, lines: [] },
      { sequence: 2, countedQuantity: 410, lines: [] },
      { sequence: 3, countedQuantity: 95, lines: [] },
    ];
    expect(dayTotal(day)).toBe(1125);
  });
});

describe('how it graded', () => {
  const totals = gradeTotals(lines, grades);

  it('reports grades in the farm’s configured order, not by size', () => {
    expect(totals.map((t) => t.key)).toEqual(['xl', 'large', 'medium', 'cracked', 'dirty']);
  });

  it('gives each a share, and the shares account for everything', () => {
    expect(totals.find((t) => t.key === 'large')?.sharePct).toBeCloseTo(56, 6);
    const sum = totals.reduce((s, t) => s + (t.sharePct ?? 0), 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  it('leaves out a grade nothing was recorded against', () => {
    expect(totals.some((t) => t.quantity === 0)).toBe(false);
  });

  it('has no share to report when nothing was collected', () => {
    expect(gradeTotals([], grades)).toEqual([]);
  });

  it('KEEPS EGGS RECORDED AGAINST A GRADE THAT NO LONGER EXISTS', () => {
    // A retired or renamed grade must never make eggs disappear out of a total.
    const withOrphan = [...lines, { gradeKey: 'jumbo', quantity: 25 }];
    const result = gradeTotals(withOrphan, grades);
    const orphan = result.find((t) => t.key === 'jumbo');

    expect(orphan?.quantity).toBe(25);
    expect(result.reduce((s, t) => s + t.quantity, 0)).toBe(1025);
    // Shown last, under its raw key, because it is a configuration problem.
    expect(result[result.length - 1].key).toBe('jumbo');
  });
});

describe('what can actually be sold', () => {
  it('counts only the saleable grades', () => {
    expect(saleableOf(lines, grades)).toBe(960);
    expect(rejectedOf(lines, grades)).toBe(40);
  });

  it('is a rate, and 96% of a thousand eggs is not a thousand eggs', () => {
    expect(saleableRate(lines, grades)).toBeCloseTo(96, 6);
  });

  it('treats an unrecognised grade as unsaleable, never as saleable', () => {
    const withOrphan = [...lines, { gradeKey: 'jumbo', quantity: 25 }];
    expect(saleableOf(withOrphan, grades)).toBe(960);
    expect(rejectedOf(withOrphan, grades)).toBe(65);
  });

  it('has no rate when nothing was collected', () => {
    expect(saleableRate([], grades)).toBeNull();
  });
});

describe('the house count against the grading bench', () => {
  it('reports the difference rather than choosing a winner', () => {
    expect(reconcile(1010, lines)).toEqual({ counted: 1010, graded: 1000, difference: -10 });
    expect(reconcile(990, lines)).toEqual({ counted: 990, graded: 1000, difference: 10 });
  });

  it('is nothing to reconcile when only one figure was taken', () => {
    expect(reconcile(null, lines)).toBeNull();
  });
});

describe('the lay curve', () => {
  /** A flock coming into lay: 5% on day 140, past 50% by day 142, peaking on 143. */
  const days: DayOfLay[] = [
    { onDate: d('2027-05-01'), ageDays: 140, eggs: 60, openingBirds: 1000, closingBirds: 1000 },
    { onDate: d('2027-05-02'), ageDays: 141, eggs: 300, openingBirds: 1000, closingBirds: 1000 },
    { onDate: d('2027-05-03'), ageDays: 142, eggs: 520, openingBirds: 1000, closingBirds: 1000 },
    { onDate: d('2027-05-04'), ageDays: 143, eggs: 900, openingBirds: 1000, closingBirds: 1000 },
    { onDate: d('2027-05-05'), ageDays: 144, eggs: 880, openingBirds: 1000, closingBirds: 1000 },
  ];

  it('reads forwards, in the order the days happened', () => {
    const series = henDaySeries([...days].reverse());
    expect(series.map((p) => p.ageDays)).toEqual([140, 141, 142, 143, 144]);
    expect(series[0].henDayPct).toBeCloseTo(6, 6);
    expect(series[3].henDayPct).toBeCloseTo(90, 6);
  });

  it('divides by the birds present, so a heavy mortality day is not flattered', () => {
    const [point] = henDaySeries([
      { onDate: d('2027-06-01'), ageDays: 200, eggs: 850, openingBirds: 1000, closingBirds: 900 },
    ]);
    // 850 / ((1000 + 900) / 2) = 89.47%, not 85% on the opening count.
    expect(point.henDayPct).toBeCloseTo(89.47, 2);
  });

  it('finds the conventional milestones and the peak', () => {
    const milestones = layMilestones(henDaySeries(days));
    expect(milestones.thresholds).toEqual([
      { thresholdPct: 5, ageDays: 140 },
      { thresholdPct: 50, ageDays: 142 },
    ]);
    expect(milestones.peak).toEqual({ ageDays: 143, henDayPct: 90 });
  });

  it('reports a milestone that has not happened as nothing, never as zero', () => {
    const milestones = layMilestones(henDaySeries(days.slice(0, 2)));
    expect(milestones.thresholds[1]).toEqual({ thresholdPct: 50, ageDays: null });
  });

  it('adds up everything produced, and charges it against the birds housed', () => {
    expect(cumulativeOutput(days)).toBe(2660);
    // 2,660 eggs from 1,100 birds placed = 2.42 eggs per bird housed so far.
    expect(henHoused(days, 1100)).toBeCloseTo(2.418, 3);
    expect(henHoused(days, 0)).toBeNull();
  });
});

describe('production by week', () => {
  /**
   * The case that decides the formula. Two days in the same age week: one with
   * 1,000 birds laying well, one with 100 birds laying badly.
   *
   * Averaging the two daily percentages gives 70%. Dividing the week's eggs by
   * the week's bird-days gives 86.4%, which is what actually happened.
   */
  const lopsided: DayOfLay[] = [
    { onDate: d('2027-06-01'), ageDays: 200, eggs: 900, openingBirds: 1000, closingBirds: 1000 },
    { onDate: d('2027-06-02'), ageDays: 201, eggs: 50, openingBirds: 100, closingBirds: 100 },
  ];

  it('weights by bird-days rather than averaging the daily percentages', () => {
    const [week] = weeklyLay(lopsided);
    expect(week.ageWeeks).toBe(28);
    expect(week.eggs).toBe(950);
    expect(week.birdDays).toBe(1100);
    expect(week.henDayPct).toBeCloseTo(86.36, 2);
    expect(week.henDayPct).not.toBeCloseTo(70, 1);
  });

  it('says how many days of the week were recorded, so a part week is visible', () => {
    const [week] = weeklyLay(lopsided);
    expect(week.daysRecorded).toBe(2);
  });

  it('groups by age in weeks, oldest first', () => {
    const spanning: DayOfLay[] = [
      { onDate: d('2027-06-08'), ageDays: 207, eggs: 800, openingBirds: 1000, closingBirds: 1000 },
      { onDate: d('2027-06-01'), ageDays: 200, eggs: 900, openingBirds: 1000, closingBirds: 1000 },
    ];
    expect(weeklyLay(spanning).map((w) => w.ageWeeks)).toEqual([28, 29]);
  });

  it('has no percentage for a week with no birds in it', () => {
    const empty: DayOfLay[] = [
      { onDate: d('2027-06-01'), ageDays: 200, eggs: 0, openingBirds: 0, closingBirds: 0 },
    ];
    expect(weeklyLay(empty)[0].henDayPct).toBeNull();
  });
});

describe('against the breed’s published curve', () => {
  /** Three points off a management guide: onset, ramp, and near peak. */
  const standard = { 154: 50, 161: 80, 168: 90 };

  it('returns a published point exactly as published', () => {
    expect(standardHenDayAt(154, standard)).toBe(50);
    expect(standardHenDayAt(168, standard)).toBe(90);
  });

  it('interpolates between weekly points, because samples fall on any day', () => {
    // Three days into a seven-day span rising 30 points: 50 + 3/7 x 30 = 62.9.
    expect(standardHenDayAt(157, standard)).toBe(62.9);
  });

  it('REFUSES TO EXTRAPOLATE beyond the published range', () => {
    expect(standardHenDayAt(140, standard)).toBeNull();
    expect(standardHenDayAt(300, standard)).toBeNull();
  });

  it('has no target at all when no curve has been loaded', () => {
    expect(standardHenDayAt(160, {})).toBeNull();
  });

  it('reads a curve out of configured standards, and discards impossible rows', () => {
    const loaded = layStandardFrom({
      henDayPctByAgeDays: { '154': 50, '161': 80, '168': 900, '175': 'ninety', '-7': 10 },
    });
    expect(loaded).toEqual({ 154: 50, 161: 80 });
  });

  it('is an empty curve, not a crash, when the standards say nothing', () => {
    expect(layStandardFrom(null)).toEqual({});
    expect(layStandardFrom({ bodyWeightByAgeDays: { '7': 70 } })).toEqual({});
  });

  it('compares in percentage POINTS, and negative means behind', () => {
    expect(henDayVsStandardPoints(82, 90)).toBe(-8);
    expect(henDayVsStandardPoints(93.5, 90)).toBe(3.5);
    expect(henDayVsStandardPoints(82, null)).toBeNull();
    expect(henDayVsStandardPoints(null, 90)).toBeNull();
  });
});

describe('what has not been recorded', () => {
  it('names the days with no collection at all', () => {
    const gaps = missingDays(
      [d('2027-06-01'), d('2027-06-02'), d('2027-06-05')],
      d('2027-06-01'),
      d('2027-06-05'),
    );
    expect(gaps.map((g) => g.toISOString().slice(0, 10))).toEqual(['2027-06-03', '2027-06-04']);
  });

  it('counts a day recorded at any hour as recorded', () => {
    const gaps = missingDays(
      [new Date('2027-06-01T17:30:00.000Z')],
      d('2027-06-01'),
      d('2027-06-01'),
    );
    expect(gaps).toEqual([]);
  });

  it('is every day when nothing has been recorded', () => {
    expect(missingDays([], d('2027-06-01'), d('2027-06-03'))).toHaveLength(3);
  });

  it('is nothing at all when the window runs backwards', () => {
    expect(missingDays([], d('2027-06-05'), d('2027-06-01'))).toEqual([]);
  });
});
