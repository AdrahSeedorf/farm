import { describe, it, expect } from 'vitest';
import {
  ageInDays,
  ageInWeeks,
  dailyMortalityPct,
  cumulativeMortalityPct,
  doaPct,
  averageBirdsAlive,
  henDayProductionPct,
  henHousedProduction,
  saleableRatePct,
  feedIntakePerBirdGrams,
  layerFeedConversionRatio,
  eggMassKg,
  daysOfFeedRemaining,
  rollingAverage,
  averageWeightGrams,
  uniformityCvPct,
  uniformityWithinTolerancePct,
  bodyWeightVsStandardPct,
  costPerPolPulletPesewas,
  costPerCratePesewas,
  grossMarginPct,
  ageAtLayThreshold,
  peakLay,
  round,
} from '../metrics';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('age', () => {
  it('counts calendar days from hatch', () => {
    expect(ageInDays(d('2027-01-01'), d('2027-01-01'))).toBe(0);
    expect(ageInDays(d('2027-01-01'), d('2027-01-02'))).toBe(1);
    expect(ageInDays(d('2027-01-01'), d('2027-05-07'))).toBe(126); // ~18 weeks, point of lay
  });

  it('reports whole weeks, as layer performance conventionally is', () => {
    expect(ageInWeeks(d('2027-01-01'), d('2027-01-07'))).toBe(0);
    expect(ageInWeeks(d('2027-01-01'), d('2027-01-08'))).toBe(1);
    expect(ageInWeeks(d('2027-01-01'), d('2027-05-07'))).toBe(18);
  });
});

describe('mortality', () => {
  it('computes daily mortality as a share of opening population', () => {
    expect(dailyMortalityPct(2, 2000)).toBe(0.1);
    expect(dailyMortalityPct(0, 2000)).toBe(0);
  });

  it('computes cumulative mortality against birds placed, not survivors', () => {
    // 120 dead out of 2,000 placed = 6%, regardless of how many remain
    expect(cumulativeMortalityPct(120, 2000)).toBe(6);
  });

  it('computes chick DOA as a supplier quality signal', () => {
    expect(doaPct(15, 2000)).toBe(0.75);
  });

  it('returns null rather than NaN when there are no birds', () => {
    expect(dailyMortalityPct(0, 0)).toBeNull();
    expect(cumulativeMortalityPct(5, 0)).toBeNull();
  });
});

describe('egg production', () => {
  it('averages birds across the day so heavy-mortality days are not flattered', () => {
    expect(averageBirdsAlive(2000, 1990)).toBe(1995);
  });

  it('computes hen-day production', () => {
    // 1,712 eggs from an average of 1,948 birds -> 87.885...%
    expect(round(henDayProductionPct(1712, 1950, 1946))).toBe(87.89);
  });

  it('penalises mortality in hen-day production, as it should', () => {
    const healthy = henDayProductionPct(1712, 1950, 1950)!;
    const withDeaths = henDayProductionPct(1712, 1950, 1900)!;
    // Fewer birds present producing the same eggs = a higher per-hen rate
    expect(withDeaths).toBeGreaterThan(healthy);
  });

  it('computes hen-housed production against birds originally housed', () => {
    expect(henHousedProduction(150_000, 2000)).toBe(75);
  });

  it('computes the saleable rate', () => {
    expect(round(saleableRatePct(1681, 1712))).toBe(98.19);
    expect(saleableRatePct(0, 0)).toBeNull();
  });
});

describe('feed', () => {
  it('reports intake per bird in grams, the unit layer feeding is discussed in', () => {
    // 214 kg across 1,948 birds = ~110 g/bird/day, a normal layer intake
    expect(round(feedIntakePerBirdGrams(214, 1948))).toBe(109.86);
  });

  it('computes layer FCR by mass', () => {
    const mass = eggMassKg(1712, 62); // 62 g average egg
    expect(round(mass, 3)).toBe(106.144);
    expect(round(layerFeedConversionRatio(214, mass))).toBe(2.02);
  });

  it('converts feed on hand into days of cover — the number that prompts a purchase', () => {
    expect(daysOfFeedRemaining(1750, 214)).toBeCloseTo(8.18, 2);
    expect(daysOfFeedRemaining(1750, 0)).toBeNull();
  });

  it('uses a rolling average so one odd day does not move the reorder date', () => {
    expect(rollingAverage([200, 210, 220, 214, 208, 212, 216], 7)).toBeCloseTo(211.43, 2);
    expect(rollingAverage([100, 200, 300], 2)).toBe(250);
    expect(rollingAverage([], 7)).toBeNull();
  });
});

describe('body weight and uniformity — the rearing metrics that decide the laying cycle', () => {
  const evenFlock = [1400, 1410, 1395, 1405, 1400, 1398, 1402, 1403];
  const raggedFlock = [1100, 1650, 1250, 1700, 900, 1500, 1800, 1050];

  it('computes the sample average', () => {
    expect(round(averageWeightGrams(evenFlock))).toBe(1401.63);
  });

  it('computes uniformity CV%, where lower is better', () => {
    const even = uniformityCvPct(evenFlock)!;
    const ragged = uniformityCvPct(raggedFlock)!;
    expect(even).toBeLessThan(1.5);
    expect(ragged).toBeGreaterThan(20);
    expect(ragged).toBeGreaterThan(even);
  });

  it('uses the sample standard deviation, not the population one', () => {
    // For [2,4,4,4,5,5,7,9]: population SD = 2, sample SD = 2.138
    // mean 5 -> sample CV = 42.76%, population CV would be 40%
    expect(round(uniformityCvPct([2, 4, 4, 4, 5, 5, 7, 9]))).toBe(42.76);
  });

  it('needs at least two birds to say anything about uniformity', () => {
    expect(uniformityCvPct([1400])).toBeNull();
    expect(uniformityCvPct([])).toBeNull();
  });

  it('also reports uniformity as % within tolerance, as quoted in the field', () => {
    expect(uniformityWithinTolerancePct(evenFlock, 10)).toBe(100);
    expect(uniformityWithinTolerancePct(raggedFlock, 10)!).toBeLessThan(50);
  });

  it('compares body weight against a configured breed standard', () => {
    expect(bodyWeightVsStandardPct(1400, 1400)).toBe(100);
    expect(round(bodyWeightVsStandardPct(1300, 1400))).toBe(92.86);
  });
});

describe('cost', () => {
  it('charges the cost of dead birds to the survivors, not to birds placed', () => {
    // GHS 60,000 (6,000,000 pesewas) spent rearing; 1,880 of 2,000 survive
    const perSurvivor = costPerPolPulletPesewas(6_000_000, 1880)!;
    const naivePerPlaced = 6_000_000 / 2000;
    expect(perSurvivor).toBe(3191);
    expect(perSurvivor).toBeGreaterThan(naivePerPlaced);
  });

  it('computes cost per crate', () => {
    expect(costPerCratePesewas(500_000, 1700)).toBe(294);
    expect(costPerCratePesewas(500_000, 0)).toBeNull();
  });

  it('computes gross margin %', () => {
    expect(grossMarginPct(1000, 750)).toBe(25);
    expect(grossMarginPct(0, 750)).toBeNull();
  });
});

describe('lay milestones', () => {
  const series = [
    { ageDays: 120, henDayPct: 0 },
    { ageDays: 126, henDayPct: 4.2 },
    { ageDays: 128, henDayPct: 6.1 },
    { ageDays: 140, henDayPct: 51.3 },
    { ageDays: 190, henDayPct: 93.4 },
    { ageDays: 200, henDayPct: 91.0 },
  ];

  it('finds the age at which lay first crossed a threshold', () => {
    expect(ageAtLayThreshold(series, 5)).toBe(128);
    expect(ageAtLayThreshold(series, 50)).toBe(140);
    expect(ageAtLayThreshold(series, 99)).toBeNull();
  });

  it('finds peak lay', () => {
    expect(peakLay(series)).toEqual({ ageDays: 190, henDayPct: 93.4 });
    expect(peakLay([])).toBeNull();
  });
});

describe('null discipline', () => {
  it('never returns NaN or Infinity from a zero denominator', () => {
    const results = [
      dailyMortalityPct(1, 0),
      henDayProductionPct(100, 0, 0),
      henHousedProduction(100, 0),
      saleableRatePct(1, 0),
      feedIntakePerBirdGrams(10, 0),
      daysOfFeedRemaining(10, 0),
      costPerCratePesewas(100, 0),
      grossMarginPct(0, 10),
    ];
    for (const r of results) {
      expect(r).toBeNull();
    }
  });
});
