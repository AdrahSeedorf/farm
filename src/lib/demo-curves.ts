/**
 * Demo curves — ADRAH Farms
 *
 * WHAT THIS IS, AND THE LINE IT MUST NOT CROSS.
 *
 * These generate the history of a flock that never existed, so the farm can see
 * its own software working before a single bird arrives. Every figure here is
 * what a plausible ISA Brown flock at this latitude DID — not what a breed
 * SHOULD do.
 *
 * That distinction is the whole reason this file is allowed to exist. The system
 * refuses to ship breed standards, because a target nobody can source is a lie
 * with a number on it, and every "vs standard" column on every screen reads a
 * dash until somebody pastes in the breeder's own table. That stays true with
 * the demo loaded: the demo flock has a lay rate, and nothing to compare it
 * against. Paste the real ISA Brown guide in and the comparison appears — which
 * is a better demonstration than a fabricated one, because it shows the software
 * being honest about what it does not know.
 *
 * ── DETERMINISTIC ──────────────────────────────────────────────────────────
 *
 * Same seed, same farm, every time. A demo you can re-run and get a different
 * answer from is one nobody can be shown twice, and a bug found in it cannot be
 * reproduced. The noise below is pseudo-random, not random.
 *
 * ── ROUGHLY RIGHT, NOT PRECISE ─────────────────────────────────────────────
 *
 * These are shapes drawn from general layer behaviour: lay rising to a peak
 * around thirty weeks and declining slowly, mortality heaviest in the first
 * week, feed intake climbing to a plateau. They are good enough to make the
 * screens behave like a real farm's and nowhere near good enough to plan with.
 */

// ---------------------------------------------------------------------------
// REPEATABLE NOISE
// ---------------------------------------------------------------------------

/**
 * A small, fast, seeded generator (mulberry32).
 *
 * Not `Math.random`, which would make every run a different farm. A demo that
 * cannot be reproduced is one where a bug found while showing it to somebody
 * can never be found again.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A value wobbled by up to `spread` either way, never below zero. */
export function jitter(value: number, spread: number, next: () => number): number {
  return Math.max(0, value * (1 + (next() * 2 - 1) * spread));
}

// ---------------------------------------------------------------------------
// THE CURVES
// ---------------------------------------------------------------------------

/**
 * Deaths on one day, as a share of the birds alive.
 *
 *   days 0–7     0.12% a day — brooding, where a flock is won or lost
 *   days 8–28    0.04% a day — settling
 *   days 29–112  0.012% a day — the quiet stretch of rearing
 *   day 113+     0.015% a day, drifting up with age in lay
 *
 * Integrated over a 72-week cycle this lands near 5% cumulative, which is the
 * sort of figure a well-run commercial layer flock reports. It is a shape, not
 * a prediction.
 */
export function mortalityRate(ageDays: number): number {
  if (ageDays <= 7) return 0.0012;
  if (ageDays <= 28) return 0.0004;
  if (ageDays <= 112) return 0.00012;
  // Creeps up through lay: roughly a third higher by the end of the cycle.
  return 0.00015 * (1 + (ageDays - 112) / 900);
}

/**
 * Hen-day lay rate at an age, as a percentage.
 *
 *   before day 119 (week 17)   nothing
 *   week 17 → week 30          rises steeply to a peak near 94%
 *   after week 30              declines about 0.35 points a week
 *
 * The rise is modelled as a logistic curve rather than a straight line because
 * a real flock comes into lay slowly, then very fast, then levels — and a
 * straight ramp makes the production screen look like a spreadsheet.
 */
export function layRate(ageDays: number): number {
  const PEAK = 94;
  const START = 119; // week 17
  const PEAK_AT = 210; // week 30

  if (ageDays < START) return 0;

  if (ageDays <= PEAK_AT) {
    // Logistic from ~0 to PEAK across the stimulation window.
    const midpoint = (START + PEAK_AT) / 2;
    const steepness = 0.075;
    const raw = PEAK / (1 + Math.exp(-steepness * (ageDays - midpoint)));
    return Math.max(0, Math.round(raw * 10) / 10);
  }

  const weeksPast = (ageDays - PEAK_AT) / 7;
  return Math.max(45, Math.round((PEAK - weeksPast * 0.35) * 10) / 10);
}

/**
 * Feed eaten per bird per day, in grams.
 *
 * Climbs from a chick's 12 g to a laying hen's plateau near 115 g. The plateau
 * matters more than the path: feed is the largest cost on the farm, and a demo
 * where it is wrong makes every cost screen meaningless.
 */
export function feedGramsPerBird(ageDays: number): number {
  if (ageDays <= 7) return 12 + ageDays * 1.5;
  if (ageDays <= 42) return 22 + (ageDays - 7) * 1.1;
  if (ageDays <= 112) return 61 + (ageDays - 42) * 0.5;
  if (ageDays <= 210) return 96 + (ageDays - 112) * 0.19;
  return 115;
}

/**
 * Water drunk per bird per day, in litres.
 *
 * About twice the feed by weight, which is the rule of thumb a stockman uses —
 * and the ratio the daily record warns about when it drifts. Generating it from
 * feed rather than independently means the demo exercises that check properly.
 */
export function waterLitresPerBird(ageDays: number): number {
  return (feedGramsPerBird(ageDays) * 2) / 1000;
}

/**
 * Average egg weight at an age, in grams.
 *
 * First eggs are small — around 45 g — and climb to 65 g by the end of lay.
 * This is what moves the grade mix below from mostly small to mostly large.
 */
export function eggGrams(ageDays: number): number {
  if (ageDays < 119) return 0;
  const weeks = (ageDays - 119) / 7;
  return Math.min(66, 45 + weeks * 0.62);
}

/**
 * Body weight at an age, in grams — what this flock WEIGHED.
 *
 * Deliberately NOT exported as a breed standard and never written into
 * `Breed.standards`. It produces weight samples, which are observations. The
 * target they are judged against still has to come from the breeder's guide.
 */
export function bodyWeightGrams(ageDays: number): number {
  if (ageDays <= 0) return 40;
  if (ageDays <= 42) return 40 + ageDays * 10.5;
  if (ageDays <= 126) return 481 + (ageDays - 42) * 12.4;
  if (ageDays <= 210) return 1523 + (ageDays - 126) * 4.5;
  return Math.min(2000, 1901 + (ageDays - 210) * 0.3);
}

// ---------------------------------------------------------------------------
// HOW A COLLECTION GRADES
// ---------------------------------------------------------------------------

export interface GradeMix {
  /** Keys match the seeded ProductionGrade keys. Shares sum to 1. */
  [gradeKey: string]: number;
}

/**
 * The share of a day's eggs falling into each grade.
 *
 * SHIFTS WITH AGE, because egg size does. A pullet flock at week 18 lays mostly
 * small eggs; the same flock at week 50 lays mostly large and extra large. A
 * demo with a fixed mix would make the grade split look like a constant, and
 * hide the one thing it is useful for: watching it move.
 *
 * Cracked and floor eggs are roughly 2% and 1% throughout — the losses that are
 * ordinary rather than alarming, and the reason the period report distinguishes
 * "collected" from "held as stock".
 */
export function gradeMix(ageDays: number): GradeMix {
  const grams = eggGrams(ageDays);
  const cracked = 0.02;
  const floor = 0.01;
  const saleable = 1 - cracked - floor;

  // Where the flock's average sits decides which bands it fills.
  let shares: [number, number, number, number]; // pullet, small, medium, large+XL
  if (grams < 48) shares = [0.45, 0.4, 0.13, 0.02];
  else if (grams < 53) shares = [0.12, 0.38, 0.38, 0.12];
  else if (grams < 58) shares = [0.02, 0.15, 0.48, 0.35];
  else if (grams < 62) shares = [0, 0.05, 0.32, 0.63];
  else shares = [0, 0.02, 0.2, 0.78];

  const [pullet, small, medium, big] = shares;
  return {
    pullet: pullet * saleable,
    small: small * saleable,
    medium: medium * saleable,
    // The top band splits roughly three to one between large and extra large.
    large: big * saleable * 0.75,
    extra_large: big * saleable * 0.25,
    cracked,
    floor,
  };
}

/**
 * Split a day's eggs into whole eggs per grade.
 *
 * WHOLE EGGS, AND THEY MUST ADD UP. Rounding each share independently loses or
 * invents eggs, and a demo whose grade lines do not sum to the count would trip
 * the very check the collection screen exists to make. The largest grade absorbs
 * the remainder.
 */
export function splitIntoGrades(total: number, mix: GradeMix): Record<string, number> {
  const keys = Object.keys(mix);
  const out: Record<string, number> = {};
  let assigned = 0;

  for (const key of keys) {
    const share = Math.floor(total * mix[key]);
    out[key] = share;
    assigned += share;
  }

  const biggest = keys.reduce((a, b) => (mix[a] >= mix[b] ? a : b));
  out[biggest] += total - assigned;
  return out;
}

// ---------------------------------------------------------------------------
// A DAY
// ---------------------------------------------------------------------------

export interface DemoDay {
  ageDays: number;
  deaths: number;
  culls: number;
  feedKg: number;
  waterLitres: number;
  eggs: number;
  grades: Record<string, number>;
  birdsAtStart: number;
  birdsAtEnd: number;
}

/**
 * One day of a flock's life, given how many birds it started with.
 *
 * TAKES THE POPULATION RATHER THAN DERIVING IT, because the caller is walking
 * the cycle forward and the population is the running total of everything that
 * happened before. Recomputing it here would be a second source of truth for
 * the one figure the whole system insists has only one.
 */
export function demoDay(ageDays: number, birdsAtStart: number, next: () => number): DemoDay {
  const deaths = Math.round(jitter(birdsAtStart * mortalityRate(ageDays), 0.6, next));

  // A cull is a decision, not an event that happens to you — so it is rarer and
  // clustered rather than a daily drip.
  const culls = next() < 0.04 ? Math.max(1, Math.round(jitter(deaths * 0.5, 0.8, next))) : 0;

  const birdsAtEnd = Math.max(0, birdsAtStart - deaths - culls);
  const average = (birdsAtStart + birdsAtEnd) / 2;

  const feedKg = Math.round(jitter((average * feedGramsPerBird(ageDays)) / 1000, 0.04, next) * 10) / 10;
  const waterLitres = Math.round(jitter(average * waterLitresPerBird(ageDays), 0.08, next));

  const eggs = Math.round(jitter((average * layRate(ageDays)) / 100, 0.03, next));

  return {
    ageDays,
    deaths,
    culls,
    feedKg,
    waterLitres,
    eggs,
    grades: eggs > 0 ? splitIntoGrades(eggs, gradeMix(ageDays)) : {},
    birdsAtStart,
    birdsAtEnd,
  };
}

/**
 * The whole cycle, day by day.
 *
 * Walks forward so every day's population follows from the one before — the
 * same rule the real ledger obeys.
 */
export function demoCycle(days: number, placed: number, seed = 20261012): DemoDay[] {
  const next = rng(seed);
  const out: DemoDay[] = [];
  let birds = placed;

  for (let age = 1; age <= days; age++) {
    const day = demoDay(age, birds, next);
    out.push(day);
    birds = day.birdsAtEnd;
  }

  return out;
}
