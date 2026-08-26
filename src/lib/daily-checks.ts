/**
 * Plausibility checks for the daily record — ADRAH Farms
 *
 * THE RULE: WARN, NEVER BLOCK.
 *
 * A farm system that refuses an unusual number teaches people to stop recording
 * unusual numbers — and unusual numbers are the entire reason the system exists.
 * The morning you lose 80 birds to a brooder failure is the morning the record
 * matters most, and it is exactly the entry a strict validator would reject.
 *
 * So every check here returns a message, the UI shows it, and the person can
 * confirm and carry on. What was flagged and accepted is stored on the record,
 * so a run of odd figures can be reviewed later — the point is to catch the
 * mistyped 60 that should have been 6, not to argue with reality.
 *
 * Thresholds are arguments, not constants. They come from the production type's
 * configured standards, set on veterinary advice — nothing here prescribes.
 */

import { assessTemperature, chickBehaviour, litterCondition, type BroodingCurve } from '@/lib/rearing';

export interface Warning {
  field: string;
  message: string;
}

export interface DailyCheckInput {
  population: number;
  ageDays: number;
  mortality: number;
  culls: number;
  feedKg?: number | null;
  waterLitres?: number | null;
  /** Brooding only. Absent once the flock no longer needs heat. */
  broodTempC?: number | null;
  chickBehaviour?: string | null;
  litterCondition?: string | null;
  broodingCurve?: BroodingCurve;
  /** Yesterday's figures, when there are any, for step-change detection. */
  previous?: {
    mortality?: number | null;
    feedKg?: number | null;
    waterLitres?: number | null;
  } | null;
}

export interface DailyThresholds {
  /** Daily mortality above this share of the flock is flagged. */
  mortalityAlertPctDaily: number;
  /** Feed intake per bird per day, in grams, outside this range is flagged. */
  feedGramsPerBirdMin: number;
  feedGramsPerBirdMax: number;
  /** Water is normally 1.5–2.5x feed by weight; outside this is flagged. */
  waterToFeedMin: number;
  waterToFeedMax: number;
}

/**
 * Defaults, used when a production type has no configured standards yet.
 *
 * Deliberately wide. A false alarm every morning is worse than no alarm at all —
 * people stop reading warnings they have learned to dismiss.
 */
export const DEFAULT_THRESHOLDS: DailyThresholds = {
  mortalityAlertPctDaily: 0.5,
  feedGramsPerBirdMin: 5,
  feedGramsPerBirdMax: 200,
  waterToFeedMin: 1.2,
  waterToFeedMax: 3.5,
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function checkDailyRecord(
  input: DailyCheckInput,
  thresholds: DailyThresholds = DEFAULT_THRESHOLDS,
): Warning[] {
  const warnings: Warning[] = [];
  const { population, mortality, culls, feedKg, waterLitres, previous } = input;

  // --- Impossible, rather than merely unusual -------------------------------
  if (mortality + culls > population) {
    warnings.push({
      field: 'mortality',
      message: `That removes ${mortality + culls} birds from a flock of ${population}. Check this belongs to the right house.`,
    });
  }

  // --- Mortality --------------------------------------------------------------
  if (population > 0 && mortality > 0) {
    const pct = (mortality / population) * 100;
    if (pct > thresholds.mortalityAlertPctDaily) {
      warnings.push({
        field: 'mortality',
        message: `${mortality} birds is ${round1(pct)}% of the flock today — above the ${thresholds.mortalityAlertPctDaily}% level you set. Worth a closer look at the house.`,
      });
    }
  }

  // A jump from a low baseline is a signal even when the absolute number is small.
  const priorMortality = previous?.mortality ?? null;
  if (priorMortality !== null && priorMortality >= 0 && mortality >= 5 && mortality >= priorMortality * 4) {
    warnings.push({
      field: 'mortality',
      message: `Mortality is well up on yesterday (${priorMortality} → ${mortality}).`,
    });
  }

  // --- Feed -------------------------------------------------------------------
  if (feedKg != null && feedKg > 0 && population > 0) {
    const gramsPerBird = (feedKg * 1000) / population;
    if (gramsPerBird < thresholds.feedGramsPerBirdMin) {
      warnings.push({
        field: 'feedKg',
        message: `${round1(gramsPerBird)} g per bird is very low. Was this the whole day's feed?`,
      });
    } else if (gramsPerBird > thresholds.feedGramsPerBirdMax) {
      warnings.push({
        field: 'feedKg',
        message: `${round1(gramsPerBird)} g per bird is very high. Was this bags rather than kilograms?`,
      });
    }
  }

  // --- Water ------------------------------------------------------------------
  //
  // Water is the earliest warning a poultry house gives. Birds go off water
  // before they go off feed, and before anything is visible walking the house —
  // so a drop here is worth flagging even when nothing else looks wrong.
  if (waterLitres != null && feedKg != null && feedKg > 0 && waterLitres > 0) {
    const ratio = waterLitres / feedKg;
    if (ratio < thresholds.waterToFeedMin) {
      warnings.push({
        field: 'waterLitres',
        message: `Water is only ${round1(ratio)}× feed. Birds usually drink about twice what they eat — check the drinkers are running.`,
      });
    } else if (ratio > thresholds.waterToFeedMax) {
      warnings.push({
        field: 'waterLitres',
        message: `Water is ${round1(ratio)}× feed, which is high. Check for a leak or a stuck drinker.`,
      });
    }
  }

  const priorWater = previous?.waterLitres ?? null;
  if (priorWater != null && priorWater > 0 && waterLitres != null && waterLitres > 0) {
    const change = ((waterLitres - priorWater) / priorWater) * 100;
    if (change <= -30) {
      warnings.push({
        field: 'waterLitres',
        message: `Water is down ${Math.abs(Math.round(change))}% on yesterday. This is often the first sign of a problem.`,
      });
    }
  }

  // --- Brooding -----------------------------------------------------------
  if (input.broodTempC != null) {
    const { target, verdict } = assessTemperature(
      input.broodTempC,
      input.ageDays,
      input.broodingCurve,
    );
    if (verdict === 'cold') {
      warnings.push({
        field: 'broodTempC',
        message: `${input.broodTempC}°C is below the ${target}°C target for day ${input.ageDays}. Cold chicks pile, and the ones underneath suffocate.`,
      });
    } else if (verdict === 'hot') {
      warnings.push({
        field: 'broodTempC',
        message: `${input.broodTempC}°C is above the ${target}°C target for day ${input.ageDays}.`,
      });
    }
  }

  const behaviour = chickBehaviour(input.chickBehaviour);
  if (behaviour && behaviour.implies !== 'ok') {
    warnings.push({ field: 'chickBehaviour', message: behaviour.meaning });
  }

  // THE BIRDS AND THE THERMOMETER DISAGREEING IS ITSELF THE FINDING.
  //
  // A wall thermometer reads the air where it hangs. The chicks read the
  // temperature where they actually are. When the two disagree, it is almost
  // always the thermometer that is in the wrong place — and that is worth
  // saying out loud, because otherwise the number gets believed.
  if (behaviour && input.broodTempC != null) {
    const { verdict, target } = assessTemperature(
      input.broodTempC,
      input.ageDays,
      input.broodingCurve,
    );
    if (verdict === 'ok' && (behaviour.implies === 'cold' || behaviour.implies === 'hot')) {
      warnings.push({
        field: 'chickBehaviour',
        message: `The thermometer reads ${input.broodTempC}°C, close to the ${target}°C target, but the chicks are telling you otherwise. Trust the birds — check where the thermometer is hanging.`,
      });
    }
  }

  const litter = litterCondition(input.litterCondition);
  if (litter?.concern) {
    warnings.push({
      field: 'litterCondition',
      message: `Litter recorded as ${litter.label.toLowerCase()}. Wet litter is where coccidiosis starts — worth attention before it spreads.`,
    });
  }

  return warnings;
}

/** Read thresholds out of a production type's configured standards. */
export function thresholdsFrom(standards: unknown): DailyThresholds {
  if (!standards || typeof standards !== 'object') return DEFAULT_THRESHOLDS;
  const s = standards as Record<string, unknown>;
  const num = (key: string, fallback: number) =>
    typeof s[key] === 'number' && Number.isFinite(s[key]) ? (s[key] as number) : fallback;

  return {
    mortalityAlertPctDaily: num('mortalityAlertPctDaily', DEFAULT_THRESHOLDS.mortalityAlertPctDaily),
    feedGramsPerBirdMin: num('feedGramsPerBirdMin', DEFAULT_THRESHOLDS.feedGramsPerBirdMin),
    feedGramsPerBirdMax: num('feedGramsPerBirdMax', DEFAULT_THRESHOLDS.feedGramsPerBirdMax),
    waterToFeedMin: num('waterToFeedMin', DEFAULT_THRESHOLDS.waterToFeedMin),
    waterToFeedMax: num('waterToFeedMax', DEFAULT_THRESHOLDS.waterToFeedMax),
  };
}
