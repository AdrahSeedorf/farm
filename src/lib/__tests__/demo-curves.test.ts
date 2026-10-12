import { describe, expect, it } from 'vitest';
import {
  bodyWeightGrams,
  demoCycle,
  demoDay,
  eggGrams,
  feedGramsPerBird,
  gradeMix,
  layRate,
  mortalityRate,
  rng,
  splitIntoGrades,
  waterLitresPerBird,
} from '@/lib/demo-curves';

describe('repeatable noise', () => {
  /**
   * A demo that cannot be reproduced is one where a bug found while showing it
   * to somebody can never be found again.
   */
  it('gives the same sequence from the same seed', () => {
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('gives a different sequence from a different seed', () => {
    expect(rng(1)()).not.toEqual(rng(2)());
  });

  it('stays between 0 and 1', () => {
    const next = rng(7);
    for (let i = 0; i < 500; i++) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('mortality', () => {
  it('is heaviest in brooding, where a flock is won or lost', () => {
    expect(mortalityRate(3)).toBeGreaterThan(mortalityRate(20));
    expect(mortalityRate(20)).toBeGreaterThan(mortalityRate(60));
  });

  it('drifts up again through lay', () => {
    expect(mortalityRate(500)).toBeGreaterThan(mortalityRate(120));
  });

  it('lands near 5% cumulative over a full cycle', () => {
    // The figure a well-run commercial layer flock reports. If the shape drifts
    // far from this, every cost-per-egg figure in the demo drifts with it.
    const cycle = demoCycle(504, 1000);
    const lost = 1000 - cycle[cycle.length - 1].birdsAtEnd;
    expect(lost / 1000).toBeGreaterThan(0.03);
    expect(lost / 1000).toBeLessThan(0.09);
  });
});

describe('the lay curve', () => {
  it('lays nothing before week 17', () => {
    expect(layRate(100)).toBe(0);
    expect(layRate(118)).toBe(0);
  });

  it('rises through the stimulation window', () => {
    expect(layRate(126)).toBeGreaterThan(layRate(119));
    expect(layRate(175)).toBeGreaterThan(layRate(140));
  });

  it('peaks near 94% around week 30', () => {
    expect(layRate(210)).toBeGreaterThan(90);
    expect(layRate(210)).toBeLessThanOrEqual(94);
  });

  it('declines slowly after peak, never below a floor', () => {
    expect(layRate(350)).toBeLessThan(layRate(210));
    expect(layRate(504)).toBeLessThan(layRate(350));
    expect(layRate(900)).toBeGreaterThanOrEqual(45);
  });

  it('never exceeds one egg per hen per day', () => {
    for (let age = 0; age < 700; age += 7) {
      expect(layRate(age)).toBeLessThanOrEqual(100);
    }
  });
});

describe('feed and water', () => {
  it('climbs from a chick to a laying hen and then plateaus', () => {
    expect(feedGramsPerBird(1)).toBeLessThan(20);
    expect(feedGramsPerBird(250)).toBeGreaterThan(110);
    expect(feedGramsPerBird(400)).toBe(feedGramsPerBird(300));
  });

  it('rises monotonically, with no step a stockman would question', () => {
    for (let age = 1; age < 300; age++) {
      expect(feedGramsPerBird(age + 1)).toBeGreaterThanOrEqual(feedGramsPerBird(age) - 0.001);
    }
  });

  /**
   * Water is generated FROM feed at roughly twice its weight — the stockman's
   * rule of thumb, and the ratio the daily record warns about when it drifts.
   * Generating it independently would mean the demo never exercises that check.
   */
  it('is about twice the feed by weight', () => {
    const ratio = (waterLitresPerBird(200) * 1000) / feedGramsPerBird(200);
    expect(ratio).toBeCloseTo(2, 1);
  });
});

describe('egg and body weight', () => {
  it('starts small and grows through the cycle', () => {
    expect(eggGrams(119)).toBeCloseTo(45, 0);
    expect(eggGrams(350)).toBeGreaterThan(55);
  });

  it('is zero before lay, rather than a small number', () => {
    expect(eggGrams(100)).toBe(0);
  });

  it('caps, because a hen does not lay a 90 gram egg', () => {
    expect(eggGrams(2000)).toBeLessThanOrEqual(66);
  });

  it('body weight rises through rearing and levels in lay', () => {
    expect(bodyWeightGrams(0)).toBeLessThan(60);
    expect(bodyWeightGrams(126)).toBeGreaterThan(1400);
    expect(bodyWeightGrams(210)).toBeGreaterThan(1850);
    expect(bodyWeightGrams(900)).toBeLessThanOrEqual(2000);
  });
});

describe('how a collection grades', () => {
  it('shares always sum to one', () => {
    for (const age of [120, 160, 220, 320, 450]) {
      const total = Object.values(gradeMix(age)).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 6);
    }
  });

  /**
   * THE THING THE GRADE SPLIT IS USEFUL FOR is watching it move. A fixed mix
   * would make it look like a constant.
   */
  it('shifts from small eggs to large ones as the flock ages', () => {
    const young = gradeMix(125);
    const old = gradeMix(400);
    expect(young.small + young.pullet).toBeGreaterThan(old.small + old.pullet);
    expect(old.large + old.extra_large).toBeGreaterThan(young.large + young.extra_large);
  });

  it('keeps cracked and floor eggs as an ordinary loss, not an alarm', () => {
    const mix = gradeMix(300);
    expect(mix.cracked).toBeCloseTo(0.02, 3);
    expect(mix.floor).toBeCloseTo(0.01, 3);
  });

  /**
   * A demo whose grade lines did not sum to the count would trip the very check
   * the collection screen exists to make.
   */
  it('splits into WHOLE eggs that add back up to the count', () => {
    for (const total of [1, 7, 333, 880, 1001]) {
      const split = splitIntoGrades(total, gradeMix(300));
      const sum = Object.values(split).reduce((a, b) => a + b, 0);
      expect(sum).toBe(total);
      for (const v of Object.values(split)) expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('never produces a negative grade line', () => {
    for (const total of [1, 2, 3, 5]) {
      const split = splitIntoGrades(total, gradeMix(130));
      for (const v of Object.values(split)) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('a day', () => {
  const next = rng(99);

  it('never takes a flock below zero birds', () => {
    const day = demoDay(400, 3, next);
    expect(day.birdsAtEnd).toBeGreaterThanOrEqual(0);
  });

  it('lays nothing before point of lay', () => {
    expect(demoDay(60, 1000, rng(1)).eggs).toBe(0);
  });

  it('grades every egg it collected, or none at all', () => {
    const day = demoDay(300, 1000, rng(5));
    const graded = Object.values(day.grades).reduce((a, b) => a + b, 0);
    expect(graded).toBe(day.eggs);
  });
});

describe('the whole cycle', () => {
  const cycle = demoCycle(504, 1000, 20261012);

  it('is the same farm every time, from the same seed', () => {
    const again = demoCycle(504, 1000, 20261012);
    expect(cycle.map((d) => d.eggs)).toEqual(again.map((d) => d.eggs));
  });

  it('carries the population forward, so each day follows from the last', () => {
    for (let i = 1; i < cycle.length; i++) {
      expect(cycle[i].birdsAtStart).toBe(cycle[i - 1].birdsAtEnd);
    }
  });

  it('never lays more eggs than there are birds', () => {
    for (const day of cycle) expect(day.eggs).toBeLessThanOrEqual(day.birdsAtStart);
  });

  it('produces a cycle that looks like a layer flock', () => {
    const total = cycle.reduce((sum, d) => sum + d.eggs, 0);
    // Roughly 300+ eggs per hen housed over 72 weeks.
    expect(total / 1000).toBeGreaterThan(250);
    expect(total / 1000).toBeLessThan(400);
  });
});
