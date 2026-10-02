import { round } from '@/lib/metrics';
import type { Warning } from '@/lib/warnings';

/**
 * Lighting programmes — ADRAH Farms
 *
 * WHY A LAYER FARM NEEDS THIS AT ALL.
 *
 * Daylength is the signal that tells a hen to lay. Lengthening days bring a
 * pullet into production and hold her there; shortening days take her out of it.
 * It is the one environmental lever on this farm that changes what the birds
 * actually DO rather than what can be seen about them, and it is operated by
 * somebody flipping a switch at a particular hour, which means it is operated
 * wrongly unless the hour is written down.
 *
 * WHAT IS DIFFERENT ABOUT BEING AT 6°N — and this is the whole reason the
 * numbers here are not the numbers in a European breeder manual.
 *
 *   At New Edubiase the natural day runs 11h46m to 12h29m — those are figures
 *   this module computes, not ones typed in from memory, and the swing across
 *   the ENTIRE year is about three quarters of an hour. A farm in the
 *   Netherlands rearing pullets has to spend money blacking out a house to hold
 *   the day short; here the sun does it for free, and the rearing half of most
 *   published programmes is solving a problem this farm does not have.
 *
 *   The laying half is the opposite. A hen wants 14 to 16 hours in production
 *   and the sky offers twelve, so roughly 2 to 4 hours must be supplied every
 *   single day of lay, for seventy weeks. That is not a seasonal adjustment, it
 *   is a permanent operating cost, and it is the number this module exists to
 *   state plainly before anybody buys a bird.
 *
 * NOTHING HERE IS A RULE THE SYSTEM ENFORCES. Every figure is a row in a
 * programme the farm can edit, exactly like the health schedule. The defaults
 * shipped are a starting point drawn from general layer practice for the
 * latitude and the breed, and they are labelled that way on screen. When the
 * ISA Brown management guide says otherwise, the guide wins — it describes the
 * actual bird, and this file describes a reasonable guess about it.
 *
 * THE ONE THING THE SYSTEM IS OPINIONATED ABOUT is shortening the day, because
 * doing that to a laying flock stops them laying. Even that is a WARNING and
 * never a refusal: deliberately reducing daylength is how an induced moult
 * works, and a system that refused it would be telling a farmer that a real
 * husbandry practice is a bug.
 */

// ---------------------------------------------------------------------------
// WHERE THE SUN IS
// ---------------------------------------------------------------------------

/**
 * Sunrise, sunset and daylength for a latitude and a date.
 *
 * THE FORMULA, stated rather than buried — NOAA's general solar position
 * calculations, the standard low-precision set:
 *
 *   Fractional year, in radians:
 *     γ = 2π/365 · (dayOfYear − 1)
 *
 *   Equation of time, in minutes (how far ahead or behind a sundial runs):
 *     E = 229.18 · ( 0.000075
 *                  + 0.001868·cos γ  − 0.032077·sin γ
 *                  − 0.014615·cos 2γ − 0.040849·sin 2γ )
 *
 *   Solar declination, in radians (the sun's tilt north or south):
 *     δ =  0.006918 − 0.399912·cos γ  + 0.070257·sin γ
 *                   − 0.006758·cos 2γ + 0.000907·sin 2γ
 *                   − 0.002697·cos 3γ + 0.001480·sin 3γ
 *
 *   Hour angle at sunrise, in degrees:
 *     cos H = cos(90.833°) / (cos φ · cos δ) − tan φ · tan δ
 *
 *   90.833° rather than 90° is the sun's own width plus the bend of its light
 *   through the atmosphere — which is why the sun is visible for a few minutes
 *   after it has geometrically set.
 *
 *   Solar noon and the two events, in minutes after local midnight:
 *     noon    = 720 − 4·longitude − E + 60·utcOffsetHours
 *     sunrise = noon − 4·H
 *     sunset  = noon + 4·H
 *
 *   Longitude is EAST-POSITIVE, so New Edubiase at about 1°W is −1.
 *
 * ACCURACY, honestly: checked against published sunrise tables for Accra and
 * agreeing within about five minutes, worst at the solstices. That is far finer
 * than the question being asked, which is what time somebody flips a switch —
 * but it is five minutes, not one, and nothing here should be quoted as an
 * almanac.
 *
 * GHANA HAS NO DAYLIGHT SAVING and sits on GMT all year, so `utcOffsetHours`
 * defaults to 0. It is a parameter rather than a constant because a constant
 * would be a quiet claim that this software only works in one country.
 */
export interface SunTimes {
  /** Minutes after local midnight. */
  sunriseMinutes: number;
  sunsetMinutes: number;
  /** Hours of natural daylight. */
  daylengthHours: number;
}

export function sunTimes(
  latitude: number,
  longitude: number,
  on: Date,
  utcOffsetHours = 0,
): SunTimes | null {
  // Above the Arctic and Antarctic circles the sun may not rise or set at all,
  // and there is no sunrise time to return. Returning null says so; returning
  // a number would be a lie that reads as a fact.
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 89.9) return null;

  const gamma = ((2 * Math.PI) / 365) * (dayOfYear(on) - 1);

  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const phi = (latitude * Math.PI) / 180;
  const cosH =
    Math.cos((90.833 * Math.PI) / 180) / (Math.cos(phi) * Math.cos(decl)) -
    Math.tan(phi) * Math.tan(decl);

  // Outside [-1, 1] the sun never crosses the horizon on this date.
  if (cosH > 1 || cosH < -1) return null;

  const hourAngle = (Math.acos(cosH) * 180) / Math.PI;
  const noon = 720 - 4 * longitude - eqTime + 60 * utcOffsetHours;

  return {
    sunriseMinutes: Math.round(noon - 4 * hourAngle),
    sunsetMinutes: Math.round(noon + 4 * hourAngle),
    daylengthHours: round((8 * hourAngle) / 60, 2) ?? 0,
  };
}

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const here = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((here - start) / 86_400_000) + 1;
}

/** 334 → "05:34". Minutes past midnight, as a clock reads it. */
export function clock(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 2.5 → "2h 30m". Hours, as somebody would say them out loud. */
export function duration(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ---------------------------------------------------------------------------
// THE PROGRAMME
// ---------------------------------------------------------------------------

/**
 * One instruction: from this age, give this many hours of light.
 *
 * AGE IN DAYS, not weeks, because a flock has an age in days and converting at
 * the edges is how an off-by-seven creeps in. The screens say weeks.
 */
export interface LightingStep {
  ageDays: number;
  /** Total hours of light per day, natural and artificial together. */
  totalHours: number;
  /**
   * Target light level at bird height, in lux. Null where nobody has measured.
   *
   * NULL IS NOT ZERO AND NOT A DEFAULT. Lux depends on the lamp, the height,
   * the dust on the bulb and the colour of the walls, and no figure typed into
   * software knows any of that. A blank reports that nobody has measured, which
   * is the true state of most farms, and is more useful than a confident number
   * nobody checked.
   */
  lux: number | null;
  note?: string | null;
}

/** Where the extra hours go relative to the natural day. */
export const SUPPLEMENT_MODES = ['MORNING', 'EVENING', 'SPLIT'] as const;
export type SupplementMode = (typeof SUPPLEMENT_MODES)[number];

export const MODE_LABELS: Record<SupplementMode, string> = {
  MORNING: 'All before sunrise',
  EVENING: 'All after sunset',
  SPLIT: 'Half before sunrise, half after sunset',
};

export const MODE_HINTS: Record<SupplementMode, string> = {
  MORNING:
    'The usual choice. Birds wake, eat and lay early, and the lights go off into daylight rather than into darkness.',
  EVENING:
    'Extends feeding into the evening, which can help in heat — birds eat more when it is cooler. Needs a dimmer or a dusk lamp so the house does not go black in one step.',
  SPLIT:
    'Spreads the cost of the generator across two shorter runs and gives a second feeding peak. More switching to get wrong.',
};

/**
 * What the programme asks for at a given age.
 *
 * THE LATEST STEP AT OR BEFORE THE AGE WINS. A programme is a set of changes,
 * not a value for every single day, so the instruction in force is the most
 * recent one the flock has reached.
 *
 * NULL BEFORE THE FIRST STEP, deliberately. A programme that starts at day 105
 * says nothing about a day-10 chick, and interpolating backwards from it would
 * invent an instruction nobody wrote.
 */
export function stepAt(steps: LightingStep[], ageDays: number): LightingStep | null {
  const reached = steps
    .filter((s) => s.ageDays <= ageDays)
    .sort((a, b) => a.ageDays - b.ageDays);
  return reached[reached.length - 1] ?? null;
}

/** The next change due, so a screen can say what is coming and when. */
export function nextStep(steps: LightingStep[], ageDays: number): LightingStep | null {
  const ahead = steps.filter((s) => s.ageDays > ageDays).sort((a, b) => a.ageDays - b.ageDays);
  return ahead[0] ?? null;
}

/**
 * Generic so the caller's own fields survive the sort.
 *
 * A signature of `LightingStep[] → LightingStep[]` would quietly widen a row
 * that carries its own id into one that does not, and the screen would lose the
 * handle it needs to edit the thing it is displaying.
 */
export function sortSteps<T extends { ageDays: number }>(steps: T[]): T[] {
  return [...steps].sort((a, b) => a.ageDays - b.ageDays);
}

// ---------------------------------------------------------------------------
// WHAT TO ACTUALLY DO TODAY
// ---------------------------------------------------------------------------

export interface LightingPlan {
  targetHours: number;
  naturalHours: number;
  /**
   * How far BELOW the natural day the programme is asking to go.
   *
   * A LAMP CANNOT MAKE A DAY SHORTER. Most layer houses in Ghana are open-sided,
   * which means the achievable floor is whatever the sky gives — about twelve
   * hours — and a programme asking for ten is asking for something no switch can
   * deliver. Only blacking the house out can, and that is a building decision,
   * not a lighting one. Zero when the target is at or above the natural day.
   */
  belowNaturalHours: number;
  /** Hours the lamps must supply. Zero when the sky already does it. */
  supplementHours: number;
  /** Minutes after midnight, or null where that end needs no lamp. */
  morningOnAt: number | null;
  morningOffAt: number | null;
  eveningOnAt: number | null;
  eveningOffAt: number | null;
  /** Hours of unbroken darkness the birds get. */
  darkHours: number;
  sentence: string;
}

/**
 * Turn a target into switch times.
 *
 * THE OUTPUT IS A CLOCK TIME, not a number of hours, because nobody operates a
 * light switch in hours. "Lights on at 04:10, off at sunrise" is an instruction;
 * "supplement 2.3 hours" is a quantity somebody has to convert at five in the
 * morning, and will eventually convert wrongly.
 *
 * MORNING LIGHT GOES OFF INTO DAYLIGHT. That is why MORNING is the default: the
 * house never goes from lit to black in one step, which is what sends birds
 * piling into corners. Evening supplement needs a dimmer or a dusk lamp, and the
 * warning below says so rather than leaving it to be discovered.
 */
export function planFor(
  target: number,
  sun: SunTimes,
  mode: SupplementMode = 'MORNING',
): LightingPlan {
  const natural = sun.daylengthHours;
  const supplement = Math.max(0, round(target - natural, 2) ?? 0);
  const supplementMinutes = Math.round(supplement * 60);

  let morning = 0;
  let evening = 0;
  if (mode === 'MORNING') morning = supplementMinutes;
  else if (mode === 'EVENING') evening = supplementMinutes;
  else {
    morning = Math.round(supplementMinutes / 2);
    evening = supplementMinutes - morning;
  }

  const plan: LightingPlan = {
    targetHours: round(target, 2) ?? 0,
    naturalHours: natural,
    belowNaturalHours: Math.max(0, round(natural - target, 2) ?? 0),
    supplementHours: supplement,
    morningOnAt: morning > 0 ? sun.sunriseMinutes - morning : null,
    morningOffAt: morning > 0 ? sun.sunriseMinutes : null,
    eveningOnAt: evening > 0 ? sun.sunsetMinutes : null,
    eveningOffAt: evening > 0 ? sun.sunsetMinutes + evening : null,
    darkHours: round(24 - Math.max(target, natural), 2) ?? 0,
    sentence: '',
  };

  plan.sentence = planSentence(plan);
  return plan;
}

function planSentence(plan: LightingPlan): string {
  // SAID FIRST, because it is the case where following the programme is
  // impossible rather than merely inconvenient, and nothing else on the screen
  // would reveal it.
  if (plan.belowNaturalHours > 0) {
    return (
      `The programme asks for ${duration(plan.targetHours)}, which is ${duration(
        plan.belowNaturalHours,
      )} SHORTER than the natural day here (${duration(plan.naturalHours)}). ` +
      `A lamp cannot shorten a day. In an open-sided house this cannot be done at all; ` +
      `it needs the house blacked out, which is a building decision.`
    );
  }

  if (plan.supplementHours === 0) {
    return `No lamps needed. The sky gives ${duration(
      plan.naturalHours,
    )} and the programme asks for ${duration(plan.targetHours)}.`;
  }

  const parts: string[] = [];
  if (plan.morningOnAt !== null) {
    parts.push(`on at ${clock(plan.morningOnAt)}, off at sunrise (${clock(plan.morningOffAt!)})`);
  }
  if (plan.eveningOnAt !== null) {
    parts.push(`on at sunset (${clock(plan.eveningOnAt)}), off at ${clock(plan.eveningOffAt!)}`);
  }

  return `${duration(plan.supplementHours)} of lamps: ${parts.join(', then ')}. That gives ${duration(
    plan.targetHours,
  )} of light and ${duration(plan.darkHours)} of dark.`;
}

/**
 * Whether anybody will actually do this.
 *
 * A PLAN SOMEBODY SLEEPS THROUGH IS NOT A PLAN. At this latitude a 15-hour day
 * means three hours of lamps, and all of it in the morning puts the switch-on at
 * around three o'clock. That is a correct answer and a useless instruction: it
 * will be done late, or not at all, and the flock gets an inconsistent day —
 * which is worse for production than a shorter consistent one.
 *
 * A TIMER FIXES THIS AND COSTS ALMOST NOTHING, which is why the note names it
 * rather than just suggesting somebody get up earlier.
 */
export function practicalityNote(plan: LightingPlan, mode: SupplementMode): string | null {
  const EARLY = 4 * 60; // 04:00
  const LATE = 21 * 60; // 21:00

  if (plan.morningOnAt !== null && plan.morningOnAt < EARLY) {
    return (
      `That is a ${clock(plan.morningOnAt)} start for whoever flips the switch. ` +
      (mode === 'MORNING'
        ? 'Splitting it between morning and evening would make it two more reasonable times, and a cheap time switch removes the question entirely — a day the birds get inconsistently is worse than a shorter one they get every day.'
        : 'A cheap time switch removes the question — a day the birds get inconsistently is worse than a shorter one they get every day.')
    );
  }

  if (plan.eveningOffAt !== null && plan.eveningOffAt > LATE) {
    return `The lamps run until ${clock(
      plan.eveningOffAt,
    )}. Make sure they dim or switch off in stages — a house going from lit to black in one step sends birds piling into corners.`;
  }

  return null;
}

/**
 * What a whole year of this costs in lamp-hours.
 *
 * NOT IN CEDIS, and that is deliberate. Turning hours into money needs the
 * wattage of lamps nobody has bought yet and a tariff that changes; a figure
 * built on two guesses would be quoted back as a fact. Lamp-hours is what this
 * module actually knows, and the farm can multiply it by their own numbers.
 */
export function annualLampHours(
  steps: LightingStep[],
  latitude: number,
  longitude: number,
  year: number,
  fromAgeDays: number,
  toAgeDays: number,
  hatchedOn: Date,
): number | null {
  if (!Number.isFinite(latitude)) return null;
  let total = 0;
  for (let age = fromAgeDays; age <= toAgeDays; age++) {
    const step = stepAt(steps, age);
    if (!step) continue;
    const date = new Date(hatchedOn.getTime() + age * 86_400_000);
    if (date.getUTCFullYear() !== year && year !== 0) continue;
    const sun = sunTimes(latitude, longitude, date);
    if (!sun) continue;
    total += Math.max(0, step.totalHours - sun.daylengthHours);
  }
  return round(total, 1);
}

// ---------------------------------------------------------------------------
// CHECKING A PROGRAMME
// ---------------------------------------------------------------------------

export function stepErrors(step: {
  ageDays: number;
  totalHours: number;
  lux: number | null;
}): string[] {
  const problems: string[] = [];

  if (!Number.isInteger(step.ageDays) || step.ageDays < 0) {
    problems.push('Age must be a whole number of days, and cannot be negative.');
  }
  if (step.ageDays > 1000) {
    problems.push('That age is beyond any laying flock. Check whether weeks were typed as days.');
  }
  // A day is 24 hours. This is arithmetic, not husbandry, so it refuses.
  if (!(step.totalHours > 0) || step.totalHours > 24) {
    problems.push('Hours of light must be more than 0 and no more than 24.');
  }
  if (step.lux !== null && (!(step.lux > 0) || step.lux > 1000)) {
    problems.push('Lux must be between 1 and 1000, or left blank if nobody has measured it.');
  }

  return problems;
}

/**
 * What ought to make somebody look twice at a programme.
 *
 * EVERY ONE OF THESE SAVES ONCE CONFIRMED. The rule across this system is warn,
 * never block, and it binds hardest here: the most dangerous-looking entry in
 * this whole file — cutting the day on a laying flock — is a real and deliberate
 * husbandry practice. Refusing it would mean the software had decided it knows
 * the birds better than the person standing in front of them.
 */
/**
 * Stepping the day DOWN in the first fortnight is standard everywhere.
 *
 * Chicks are given a near-continuous day for the first two or three days so they
 * find feed and water, and it is then reduced to the rearing photoperiod. Every
 * guide for every layer breed does this. Warning about it would mean the first
 * thing anybody sees on a correct programme is an alarm — which is how people
 * learn to click past alarms.
 */
export const BROODING_STEP_DOWN_DAYS = 14;

export function programmeWarnings(
  steps: LightingStep[],
  options: { productionStartAgeDays?: number | null } = {},
): Warning[] {
  const warnings: Warning[] = [];
  const sorted = sortSteps(steps);
  const layStart = options.productionStartAgeDays ?? null;

  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const step = sorted[i];

    if (step.ageDays === previous.ageDays) {
      warnings.push({
        field: `step-${step.ageDays}`,
        message: `There are two instructions for day ${step.ageDays}. Whichever is saved last is the one that will be followed.`,
      });
    }

    if (step.totalHours < previous.totalHours && step.ageDays > BROODING_STEP_DOWN_DAYS) {
      const cut = round(previous.totalHours - step.totalHours, 2) ?? 0;
      /**
       * UNKNOWN MUST NOT READ AS SAFE.
       *
       * The first version of this had three states collapsed into two: known to
       * be in lay got the loud warning, and everything else — including "nobody
       * has told this system when laying starts" — got the mild one. So a
       * programme not attached to a production type silently received the gentle
       * wording for the single most damaging edit in the file. Unknown now says
       * it is unknown, which is the only honest third answer.
       */
      const inLay = layStart !== null && step.ageDays >= layStart;
      const beforeLay = layStart !== null && step.ageDays < layStart;

      warnings.push({
        field: `step-${step.ageDays}`,
        message: inLay
          ? `Day ${step.ageDays} SHORTENS the day by ${duration(cut)} after the birds are in lay. ` +
            `Cutting daylight is what takes hens out of production — it is how a moult is induced, and if that is not what you mean, this will cost you eggs. Save it only if it is deliberate.`
          : beforeLay
            ? `Day ${step.ageDays} shortens the day by ${duration(cut)}, while the birds are still being reared. That is sometimes intended; after lay begins it stops birds laying. Check it is what you mean.`
            : `Day ${step.ageDays} SHORTENS the day by ${duration(cut)}, and this system does not know when these birds start laying — no production-start age is set on the lifecycle stage, and this programme may not be attached to a production type. ` +
              `If they are in lay, cutting daylight takes them out of production. Save it only if it is deliberate.`,
      });
    }

    const jump = round(step.totalHours - previous.totalHours, 2) ?? 0;
    const weeksBetween = (step.ageDays - previous.ageDays) / 7;
    if (jump > 0 && weeksBetween > 0 && jump / weeksBetween > 1.5) {
      warnings.push({
        field: `step-${step.ageDays}`,
        message: `Day ${step.ageDays} adds ${duration(
          jump,
        )} at once. Most guides step up by half an hour to an hour a week; a bigger jump can bring birds into lay before they are heavy enough, which means small eggs and prolapse.`,
      });
    }
  }

  for (const step of sorted) {
    if (step.totalHours > 17) {
      warnings.push({
        field: `step-${step.ageDays}`,
        message: `Day ${step.ageDays} asks for ${duration(
          step.totalHours,
        )} of light, leaving only ${duration(
          24 - step.totalHours,
        )} of dark. Birds need an unbroken dark period to rest and to form shell. Very long days also cost more than they return.`,
      });
    }
    if (step.lux === null) {
      warnings.push({
        field: `lux-${step.ageDays}`,
        message: `Nobody has stated a light level for day ${step.ageDays}. The programme still works — it just cannot tell anybody whether the lamps are bright enough.`,
      });
    }
  }

  return warnings;
}

/**
 * The thing a farm at this latitude should read before it buys a bird.
 *
 * Said as a cost of doing business rather than as a setting, because that is
 * what it is: at 6°N the lamps run every day of lay, for the whole cycle.
 */
export function latitudeNote(
  latitude: number | null,
  sun: SunTimes | null,
  layingTargetHours: number | null,
): string {
  if (latitude === null || sun === null) {
    return 'This farm has no latitude recorded, so the natural daylength cannot be worked out and no switch-on time can be given. Settings → Farms.';
  }

  const base = `At this latitude the natural day is about ${duration(
    sun.daylengthHours,
  )}, and it barely changes across the year.`;

  if (layingTargetHours === null) return base;

  const gap = round(layingTargetHours - sun.daylengthHours, 2) ?? 0;
  if (gap <= 0) {
    return `${base} The programme asks for ${duration(
      layingTargetHours,
    )}, which the sky already provides, so no lamps are needed.`;
  }

  return (
    `${base} A laying flock wants ${duration(layingTargetHours)}, so about ${duration(
      gap,
    )} of lamps are needed EVERY DAY OF LAY — not seasonally. Over a 70-week cycle that is roughly ` +
    `${Math.round(gap * 7 * 70)} lamp-hours per house, and it is a running cost rather than a setting.`
  );
}
