/**
 * Production metrics — ADRAH Farms
 *
 * Every formula in the platform lives here, documented, tested, and in one file.
 *
 * WHY ONE FILE: a farm metric that is computed in three places will eventually be
 * computed three different ways, and the dashboard will disagree with the report.
 * When that happens nobody trusts either. There is exactly one implementation of
 * "hen-day production" in this codebase, and it is below.
 *
 * CONVENTION: every function returns `null` rather than NaN or Infinity when its
 * denominator is zero or its inputs are incoherent. The UI renders null as "—",
 * which is honest. A zero would be a lie.
 *
 * NOTE ON TARGETS: nothing here hard-codes a breed standard, a healthy mortality
 * rate, or a vaccination age. Those are configuration (ProductionTypeProfile.standards),
 * set on veterinary advice. This file computes; it does not prescribe.
 */

/** Guard: null unless the denominator is usable. */
function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function pct(numerator: number, denominator: number): number | null {
  const r = ratio(numerator, denominator);
  return r === null ? null : r * 100;
}

/** Round to `dp` decimal places for presentation. */
export function round(value: number | null, dp = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

// ---------------------------------------------------------------------------
// AGE
// ---------------------------------------------------------------------------

/**
 * Age in days from date of hatch. Calendar days, not elapsed milliseconds —
 * a bird hatched yesterday evening is 1 day old this morning, which is how
 * every vaccination schedule in the world counts.
 */
export function ageInDays(dateOfHatch: Date, on: Date): number {
  const a = Date.UTC(dateOfHatch.getUTCFullYear(), dateOfHatch.getUTCMonth(), dateOfHatch.getUTCDate());
  const b = Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate());
  return Math.floor((b - a) / 86_400_000);
}

/** Age in whole weeks — how layer performance is conventionally reported. */
export function ageInWeeks(dateOfHatch: Date, on: Date): number {
  return Math.floor(ageInDays(dateOfHatch, on) / 7);
}

// ---------------------------------------------------------------------------
// MORTALITY
// ---------------------------------------------------------------------------

/** Daily mortality % = deaths today / opening population x 100 */
export function dailyMortalityPct(deathsToday: number, openingPopulation: number): number | null {
  return pct(deathsToday, openingPopulation);
}

/** Cumulative mortality % = total deaths to date / birds placed x 100 */
export function cumulativeMortalityPct(totalDeaths: number, birdsPlaced: number): number | null {
  return pct(totalDeaths, birdsPlaced);
}

/**
 * Mortality over any window, as a % of birds placed. Used for the two windows
 * that matter most when rearing from day-old:
 *   brooding  — day 0 to ~28
 *   rearing   — day 0 to point of lay (~day 126)
 * The window is supplied by the caller so it stays configurable.
 */
export function windowMortalityPct(deathsInWindow: number, birdsPlaced: number): number | null {
  return pct(deathsInWindow, birdsPlaced);
}

/** Chick dead-on-arrival % = DOA / chicks received x 100. A supplier quality signal. */
export function doaPct(deadOnArrival: number, chicksReceived: number): number | null {
  return pct(deadOnArrival, chicksReceived);
}

// ---------------------------------------------------------------------------
// EGG PRODUCTION
// ---------------------------------------------------------------------------

/**
 * Average birds alive across a day = (opening + closing) / 2.
 *
 * Using opening alone overstates hen-day production on days with heavy
 * mortality — precisely the days you most need an honest number.
 */
export function averageBirdsAlive(openingPopulation: number, closingPopulation: number): number {
  return (openingPopulation + closingPopulation) / 2;
}

/**
 * Hen-day production % = eggs produced today / average birds alive today x 100
 *
 * The headline layer metric: what share of the birds actually present laid today.
 */
export function henDayProductionPct(
  eggsProduced: number,
  openingPopulation: number,
  closingPopulation: number,
): number | null {
  return pct(eggsProduced, averageBirdsAlive(openingPopulation, closingPopulation));
}

/**
 * Hen-housed production = cumulative eggs / birds originally housed
 *
 * Eggs per bird placed, so mortality is charged against performance. This is the
 * number that reflects the economics of the flock rather than the survivors.
 */
export function henHousedProduction(cumulativeEggs: number, birdsHoused: number): number | null {
  return ratio(cumulativeEggs, birdsHoused);
}

/** Saleable rate % = saleable eggs / total eggs collected x 100 */
export function saleableRatePct(saleableEggs: number, totalCollected: number): number | null {
  return pct(saleableEggs, totalCollected);
}

// ---------------------------------------------------------------------------
// FEED
// ---------------------------------------------------------------------------

/**
 * Feed intake per bird per day, in GRAMS.
 *   = feed consumed (kg) x 1000 / average birds alive
 *
 * Grams because that is the unit layer feeding is discussed in — a laying hen
 * eats on the order of 110 g/day, and "0.11 kg" reads as noise.
 */
export function feedIntakePerBirdGrams(
  feedConsumedKg: number,
  averageBirds: number,
): number | null {
  return ratio(feedConsumedKg * 1000, averageBirds);
}

/**
 * Feed conversion ratio for layers, by mass:
 *   = feed consumed (kg) / egg mass produced (kg)
 *
 * Lower is better. Note this is the LAYER definition. Broilers use
 * feed (kg) / liveweight gain (kg) — a different function when that module lands,
 * because silently reusing this one would produce a plausible, wrong number.
 */
export function layerFeedConversionRatio(
  feedConsumedKg: number,
  eggMassKg: number,
): number | null {
  return ratio(feedConsumedKg, eggMassKg);
}

/** Egg mass in kg from a count and an average egg weight in grams. */
export function eggMassKg(eggCount: number, averageEggWeightGrams: number): number {
  return (eggCount * averageEggWeightGrams) / 1000;
}

/**
 * Days of feed remaining = feed on hand (kg) / rolling average daily consumption (kg)
 *
 * The single most useful stock number on the farm: it converts "we have 40 bags"
 * into "we run out on Thursday", which is what actually prompts a purchase.
 */
export function daysOfFeedRemaining(
  feedOnHandKg: number,
  averageDailyConsumptionKg: number,
): number | null {
  return ratio(feedOnHandKg, averageDailyConsumptionKg);
}

/** Rolling mean of the last `window` daily consumption figures. */
export function rollingAverage(values: number[], window: number): number | null {
  if (window <= 0 || values.length === 0) return null;
  const slice = values.slice(-window);
  if (slice.length === 0) return null;
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

// ---------------------------------------------------------------------------
// BODY WEIGHT & UNIFORMITY  (critical during rearing)
// ---------------------------------------------------------------------------

/** Mean of a weight sample, in grams. */
export function averageWeightGrams(weights: number[]): number | null {
  if (weights.length === 0) return null;
  return weights.reduce((s, w) => s + w, 0) / weights.length;
}

/**
 * Uniformity, as coefficient of variation %:
 *   = standard deviation of sample / mean of sample x 100
 *
 * LOWER IS BETTER. A flock with high CV comes into lay raggedly, peaks lower and
 * holds peak for less time — and it cannot be corrected after point of lay, which
 * is why this is measured weekly through rearing rather than once at the end.
 *
 * Uses the SAMPLE standard deviation (n-1, Bessel's correction), because these
 * birds are a sample of the flock, not the whole flock. Requires n >= 2.
 */
export function uniformityCvPct(weights: number[]): number | null {
  const n = weights.length;
  if (n < 2) return null;
  const mean = averageWeightGrams(weights);
  if (mean === null || mean <= 0) return null;
  const variance = weights.reduce((s, w) => s + (w - mean) ** 2, 0) / (n - 1);
  return (Math.sqrt(variance) / mean) * 100;
}

/**
 * Share of birds within +/- tolerance of the sample mean — the other common way
 * uniformity is quoted in the field ("82% uniformity at +/-10%").
 */
export function uniformityWithinTolerancePct(weights: number[], tolerancePct = 10): number | null {
  const mean = averageWeightGrams(weights);
  if (mean === null || mean <= 0) return null;
  const lower = mean * (1 - tolerancePct / 100);
  const upper = mean * (1 + tolerancePct / 100);
  const within = weights.filter((w) => w >= lower && w <= upper).length;
  return pct(within, weights.length);
}

/**
 * Body weight against the breed standard, as a %.
 * 100 = on target. The standard comes from configuration, never from this file.
 */
export function bodyWeightVsStandardPct(
  averageGrams: number,
  standardGramsForAge: number,
): number | null {
  return pct(averageGrams, standardGramsForAge);
}

// ---------------------------------------------------------------------------
// COST  (all money in integer pesewas — see money.ts)
// ---------------------------------------------------------------------------

/**
 * Cost per point-of-lay pullet reared
 *   = total accumulated flock cost at transfer / birds alive at transfer
 *
 * Note the denominator: birds that DIED during rearing still consumed feed, and
 * their cost is carried by the survivors. Dividing by birds placed would flatter
 * the result and hide the true cost of mortality.
 *
 * Compare this against the market price of a bought pullet to find out whether
 * rearing in-house is actually winning.
 */
export function costPerPolPulletPesewas(
  totalCostPesewas: number,
  birdsAliveAtTransfer: number,
): number | null {
  const r = ratio(totalCostPesewas, birdsAliveAtTransfer);
  return r === null ? null : Math.round(r);
}

/** Cost per egg = allocated period costs / eggs produced in that period. */
export function costPerEggPesewas(
  periodCostPesewas: number,
  eggsProduced: number,
): number | null {
  const r = ratio(periodCostPesewas, eggsProduced);
  return r === null ? null : Math.round(r);
}

/** Cost per crate of 30. */
export function costPerCratePesewas(
  periodCostPesewas: number,
  cratesProduced: number,
): number | null {
  const r = ratio(periodCostPesewas, cratesProduced);
  return r === null ? null : Math.round(r);
}

/** Gross margin % = (revenue - cost) / revenue x 100 */
export function grossMarginPct(revenuePesewas: number, costPesewas: number): number | null {
  return pct(revenuePesewas - costPesewas, revenuePesewas);
}

// ---------------------------------------------------------------------------
// LAY MILESTONES
// ---------------------------------------------------------------------------

export interface DailyLayPoint {
  ageDays: number;
  henDayPct: number | null;
}

/**
 * Age in days at which hen-day production first crossed `thresholdPct`.
 * Used for the standard milestones: age at 5% lay, at 50% lay, and at peak.
 * Returns null if the threshold was never reached.
 */
export function ageAtLayThreshold(series: DailyLayPoint[], thresholdPct: number): number | null {
  const hit = [...series]
    .filter((p) => p.henDayPct !== null && p.henDayPct >= thresholdPct)
    .sort((a, b) => a.ageDays - b.ageDays)[0];
  return hit ? hit.ageDays : null;
}

/** The highest hen-day % recorded, and the age at which it occurred. */
export function peakLay(series: DailyLayPoint[]): { ageDays: number; henDayPct: number } | null {
  const valid = series.filter(
    (p): p is { ageDays: number; henDayPct: number } => p.henDayPct !== null,
  );
  if (valid.length === 0) return null;
  return valid.reduce((best, p) => (p.henDayPct > best.henDayPct ? p : best));
}
