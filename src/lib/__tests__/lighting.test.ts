import { describe, expect, it } from 'vitest';
import {
  MODE_LABELS,
  SUPPLEMENT_MODES,
  annualLampHours,
  clock,
  duration,
  latitudeNote,
  nextStep,
  planFor,
  practicalityNote,
  programmeWarnings,
  sortSteps,
  stepAt,
  stepErrors,
  sunTimes,
  type LightingStep,
} from '@/lib/lighting';

// New Edubiase, Ashanti Region. Ghana is GMT all year, no daylight saving.
const LAT = 6.0833;
const LON = -1.0167;
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const step = (over: Partial<LightingStep> = {}): LightingStep => ({
  ageDays: 112,
  totalHours: 14,
  lux: 20,
  ...over,
});

describe('where the sun is', () => {
  /**
   * CHECKED AGAINST PUBLISHED TABLES, not against itself. A solar formula that
   * only agrees with its own output is a formula nobody has verified.
   */
  it('puts sunrise in Ghana a little after six, all year', () => {
    for (const date of ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']) {
      const sun = sunTimes(LAT, LON, d(date))!;
      expect(sun.sunriseMinutes).toBeGreaterThan(5 * 60 + 40);
      expect(sun.sunriseMinutes).toBeLessThan(6 * 60 + 20);
    }
  });

  it('agrees with published Accra sunrise within five minutes at the solstice', () => {
    // Accra, 21 December: published sunrise 06:03, sunset 17:54.
    const sun = sunTimes(5.556, -0.1969, d('2026-12-21'))!;
    expect(Math.abs(sun.sunriseMinutes - (6 * 60 + 3))).toBeLessThanOrEqual(5);
    expect(Math.abs(sun.sunsetMinutes - (17 * 60 + 54))).toBeLessThanOrEqual(5);
  });

  /**
   * THE FACT THE WHOLE DESIGN RESTS ON. If the tropical day swung like a
   * temperate one, a seasonal programme would be needed and the defaults here
   * would be wrong.
   */
  it('shows a tropical day that barely moves across the year', () => {
    let min = 99;
    let max = 0;
    for (let i = 0; i < 365; i++) {
      const sun = sunTimes(LAT, LON, new Date(Date.UTC(2026, 0, 1) + i * 86_400_000))!;
      min = Math.min(min, sun.daylengthHours);
      max = Math.max(max, sun.daylengthHours);
    }
    expect(min).toBeGreaterThan(11.7);
    expect(max).toBeLessThan(12.6);
    // Under an hour of swing across the entire year.
    expect(max - min).toBeLessThan(1);
  });

  it('gives a temperate latitude a day that does swing, so the formula is not stuck', () => {
    const june = sunTimes(52.37, 4.9, d('2026-06-21'))!; // Amsterdam
    const december = sunTimes(52.37, 4.9, d('2026-12-21'))!;
    expect(june.daylengthHours).toBeGreaterThan(16);
    expect(december.daylengthHours).toBeLessThan(8.5);
  });

  it('returns null inside the Arctic circle in midwinter rather than inventing a sunrise', () => {
    expect(sunTimes(78, 15, d('2026-12-21'))).toBeNull();
  });

  it('returns null for a latitude nobody has recorded', () => {
    expect(sunTimes(Number.NaN, LON, d('2026-06-21'))).toBeNull();
  });

  it('moves sunrise later as you go west within a time zone', () => {
    const east = sunTimes(6, 1, d('2026-06-21'))!;
    const west = sunTimes(6, -3, d('2026-06-21'))!;
    expect(west.sunriseMinutes).toBeGreaterThan(east.sunriseMinutes);
  });
});

describe('saying times out loud', () => {
  it('writes minutes past midnight as a clock', () => {
    expect(clock(0)).toBe('00:00');
    expect(clock(334)).toBe('05:34');
    expect(clock(1439)).toBe('23:59');
  });

  it('wraps rather than printing an impossible hour', () => {
    // Evening supplement can push past midnight, and 25:30 is not a time.
    expect(clock(1500)).toBe('01:00');
    expect(clock(-30)).toBe('23:30');
  });

  it('says durations the way somebody would', () => {
    expect(duration(2.5)).toBe('2h 30m');
    expect(duration(3)).toBe('3h');
    expect(duration(0.5)).toBe('30m');
  });
});

describe('what the programme asks for', () => {
  const steps = [
    step({ ageDays: 0, totalHours: 23, lux: 30 }),
    step({ ageDays: 7, totalHours: 12, lux: 15 }),
    step({ ageDays: 112, totalHours: 13, lux: 20 }),
    step({ ageDays: 126, totalHours: 14, lux: 20 }),
  ];

  it('uses the latest instruction the flock has reached', () => {
    expect(stepAt(steps, 120)?.totalHours).toBe(13);
    expect(stepAt(steps, 126)?.totalHours).toBe(14);
    expect(stepAt(steps, 500)?.totalHours).toBe(14);
  });

  it('is null before the first step rather than guessing backwards', () => {
    expect(stepAt([step({ ageDays: 105 })], 10)).toBeNull();
  });

  it('finds the next change, so a screen can say what is coming', () => {
    expect(nextStep(steps, 115)?.ageDays).toBe(126);
    expect(nextStep(steps, 400)).toBeNull();
  });

  it('does not care what order the steps arrive in', () => {
    const jumbled = [steps[3], steps[0], steps[2], steps[1]];
    expect(stepAt(jumbled, 120)?.totalHours).toBe(13);
    expect(sortSteps(jumbled).map((s) => s.ageDays)).toEqual([0, 7, 112, 126]);
  });
});

describe('what to do today', () => {
  const sun = { sunriseMinutes: 6 * 60, sunsetMinutes: 18 * 60, daylengthHours: 12 };

  it('needs no lamps when the sky already does it', () => {
    const plan = planFor(12, sun);
    expect(plan.supplementHours).toBe(0);
    expect(plan.morningOnAt).toBeNull();
    expect(plan.sentence).toMatch(/No lamps needed/);
  });

  it('never asks for negative lamp hours when the day is longer than the target', () => {
    expect(planFor(10, sun).supplementHours).toBe(0);
  });

  it('puts the morning supplement before sunrise and switches off into daylight', () => {
    const plan = planFor(14, sun);
    expect(plan.supplementHours).toBe(2);
    expect(clock(plan.morningOnAt!)).toBe('04:00');
    expect(clock(plan.morningOffAt!)).toBe('06:00');
    expect(plan.eveningOnAt).toBeNull();
  });

  it('puts the evening supplement after sunset', () => {
    const plan = planFor(14, sun, 'EVENING');
    expect(clock(plan.eveningOnAt!)).toBe('18:00');
    expect(clock(plan.eveningOffAt!)).toBe('20:00');
    expect(plan.morningOnAt).toBeNull();
  });

  it('splits an odd supplement without losing a minute', () => {
    const plan = planFor(15, sun, 'SPLIT');
    const morning = plan.morningOffAt! - plan.morningOnAt!;
    const evening = plan.eveningOffAt! - plan.eveningOnAt!;
    expect(morning + evening).toBe(180);
  });

  /**
   * A LAMP CANNOT SHORTEN A DAY. Most layer houses in Ghana are open-sided, so
   * the floor is whatever the sky gives. Nothing else on the screen would show
   * that a programme is asking for something no switch can deliver.
   */
  it('says plainly when a target is below the natural day', () => {
    const plan = planFor(10, sun);
    expect(plan.belowNaturalHours).toBe(2);
    expect(plan.sentence).toMatch(/A lamp cannot shorten a day/);
    expect(plan.sentence).toMatch(/open-sided house/);
  });

  it('is zero below-natural when the target is reachable', () => {
    expect(planFor(14, sun).belowNaturalHours).toBe(0);
    expect(planFor(12, sun).belowNaturalHours).toBe(0);
  });

  it('reports the dark period, because that is what the birds actually get', () => {
    expect(planFor(14, sun).darkHours).toBe(10);
    expect(planFor(11, sun).darkHours).toBe(12);
  });

  it('gives switch times in the sentence, not a number of hours to convert at dawn', () => {
    expect(planFor(14, sun).sentence).toMatch(/on at 04:00/);
    expect(planFor(14, sun).sentence).toMatch(/10h of dark/);
  });

  it('every supplement mode has a label and a reason', () => {
    for (const mode of SUPPLEMENT_MODES) {
      expect(MODE_LABELS[mode].length).toBeGreaterThan(0);
    }
  });
});

describe('whether anybody will actually do it', () => {
  const sun = { sunriseMinutes: 6 * 60, sunsetMinutes: 18 * 60, daylengthHours: 12 };

  it('says nothing about a reasonable start time', () => {
    expect(practicalityNote(planFor(14, sun), 'MORNING')).toBeNull();
  });

  /**
   * A plan somebody sleeps through is not a plan. Three hours of morning
   * supplement at this latitude puts the switch at three in the morning, which
   * will be done late or not at all — and an inconsistent day is worse for a
   * flock than a shorter consistent one.
   */
  it('flags a switch-on in the small hours and names the cheap fix', () => {
    const note = practicalityNote(planFor(15, sun), 'MORNING')!;
    expect(note).toMatch(/03:00 start/);
    expect(note).toMatch(/time switch/);
    expect(note).toMatch(/Splitting it/);
  });

  it('does not suggest splitting something already split', () => {
    const note = practicalityNote(planFor(20, sun), 'SPLIT');
    expect(note).not.toMatch(/Splitting it/);
  });

  it('warns about a late evening run going black in one step', () => {
    const note = practicalityNote(planFor(16, sun, 'EVENING'), 'EVENING')!;
    expect(note).toMatch(/piling into corners/);
  });
});

describe('checking a step', () => {
  it('accepts an ordinary instruction', () => {
    expect(stepErrors({ ageDays: 112, totalHours: 13.5, lux: 20 })).toEqual([]);
  });

  it('accepts a blank lux, because nobody has measured it on most farms', () => {
    expect(stepErrors({ ageDays: 112, totalHours: 13.5, lux: null })).toEqual([]);
  });

  it('refuses more than 24 hours in a day, which is arithmetic rather than husbandry', () => {
    expect(stepErrors({ ageDays: 1, totalHours: 25, lux: null }).join(' ')).toMatch(
      /no more than 24/,
    );
  });

  it('refuses zero hours', () => {
    expect(stepErrors({ ageDays: 1, totalHours: 0, lux: null }).join(' ')).toMatch(/more than 0/);
  });

  it('catches weeks typed into the days box', () => {
    expect(stepErrors({ ageDays: 5000, totalHours: 14, lux: null }).join(' ')).toMatch(
      /weeks were typed as days/,
    );
  });
});

describe('warning about a programme', () => {
  const rising = [
    step({ ageDays: 112, totalHours: 13 }),
    step({ ageDays: 119, totalHours: 13.5 }),
    step({ ageDays: 126, totalHours: 14 }),
  ];

  it('says nothing about a sensible rising programme', () => {
    expect(programmeWarnings(rising, { productionStartAgeDays: 126 })).toEqual([]);
  });

  /**
   * THE WARNING THAT MATTERS MOST, and the one that must never become a refusal.
   * Cutting daylight on a laying flock stops them laying — and that is exactly
   * how an induced moult is done, which is a real practice this software has no
   * business forbidding.
   */
  it('warns loudly about shortening the day once birds are in lay', () => {
    const cut = [...rising, step({ ageDays: 200, totalHours: 12 })];
    const warnings = programmeWarnings(cut, { productionStartAgeDays: 126 });
    expect(warnings.some((w) => /SHORTENS/.test(w.message))).toBe(true);
    expect(warnings.some((w) => /how a moult is induced/.test(w.message))).toBe(true);
  });

  it('says nothing about the brooding step-down, which every guide prescribes', () => {
    // Warning about a correct programme is how people learn to click past
    // warnings, and then miss the one that mattered.
    const brooding = [
      step({ ageDays: 0, totalHours: 22 }),
      step({ ageDays: 3, totalHours: 18 }),
      step({ ageDays: 7, totalHours: 12 }),
    ];
    const warnings = programmeWarnings(brooding, { productionStartAgeDays: 126 });
    expect(warnings.some((w) => /shortens the day/i.test(w.message))).toBe(false);
  });

  it('is gentler about shortening the day in later rearing, where it may be meant', () => {
    const cut = [
      step({ ageDays: 21, totalHours: 14 }),
      step({ ageDays: 42, totalHours: 12 }),
    ];
    const warnings = programmeWarnings(cut, { productionStartAgeDays: 126 });
    expect(warnings[0].message).toMatch(/sometimes intended/);
    expect(warnings[0].message).not.toMatch(/SHORTENS/);
  });

  /**
   * UNKNOWN MUST NOT READ AS SAFE. The first version collapsed three states into
   * two, so a programme that was not attached to a production type silently got
   * the mild wording for the most damaging edit in the file. The browser caught
   * it.
   */
  it('says it does not know, rather than giving the mild warning, when lay start is unset', () => {
    const cut = [
      step({ ageDays: 140, totalHours: 15 }),
      step({ ageDays: 200, totalHours: 12 }),
    ];
    const warnings = programmeWarnings(cut, { productionStartAgeDays: null });
    expect(warnings[0].message).toMatch(/SHORTENS/);
    expect(warnings[0].message).toMatch(/does not know when these birds start laying/);
    expect(warnings[0].message).not.toMatch(/sometimes intended/);
  });

  it('warns when the day is lengthened too fast for the birds to grow into it', () => {
    const steep = [
      step({ ageDays: 112, totalHours: 12 }),
      step({ ageDays: 119, totalHours: 16 }),
    ];
    const warnings = programmeWarnings(steep);
    expect(warnings.some((w) => /small eggs and prolapse/.test(w.message))).toBe(true);
  });

  it('warns when there is almost no dark period left', () => {
    const warnings = programmeWarnings([step({ ageDays: 112, totalHours: 18 })]);
    expect(warnings.some((w) => /unbroken dark period/.test(w.message))).toBe(true);
  });

  it('says plainly when nobody has stated a light level', () => {
    const warnings = programmeWarnings([step({ lux: null })]);
    expect(warnings.some((w) => /cannot tell anybody whether the lamps are bright enough/.test(w.message))).toBe(
      true,
    );
  });

  it('catches two instructions for the same day', () => {
    const clash = [step({ ageDays: 112, totalHours: 13 }), step({ ageDays: 112, totalHours: 14 })];
    expect(programmeWarnings(clash).some((w) => /two instructions for day 112/.test(w.message))).toBe(
      true,
    );
  });
});

describe('what this latitude costs', () => {
  it('says plainly when the farm has no latitude, rather than assuming one', () => {
    // Assuming 6°N because the farm is "in Ghana" would be a guess wearing the
    // clothes of a measurement.
    const note = latitudeNote(null, null, 14);
    expect(note).toMatch(/no latitude recorded/);
    expect(note).not.toMatch(/\d+h/);
  });

  it('states the lamps as a permanent running cost, not a seasonal adjustment', () => {
    const sun = sunTimes(LAT, LON, d('2026-06-21'))!;
    const note = latitudeNote(LAT, sun, 14);
    expect(note).toMatch(/EVERY DAY OF LAY/);
    expect(note).toMatch(/running cost/);
  });

  it('says no lamps are needed where the sky already gives enough', () => {
    const sun = sunTimes(LAT, LON, d('2026-06-21'))!;
    expect(latitudeNote(LAT, sun, 11)).toMatch(/no lamps are needed/);
  });

  it('counts lamp hours over a cycle, in hours rather than in invented cedis', () => {
    const hours = annualLampHours(
      [step({ ageDays: 126, totalHours: 14 })],
      LAT,
      LON,
      0,
      126,
      126 + 364,
      d('2026-01-01'),
    );
    // About two hours a day for a year.
    expect(hours).toBeGreaterThan(600);
    expect(hours).toBeLessThan(800);
  });

  it('is null where there is no latitude to compute from', () => {
    expect(
      annualLampHours([step()], Number.NaN, LON, 0, 126, 200, d('2026-01-01')),
    ).toBeNull();
  });
});
