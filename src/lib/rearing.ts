/**
 * Rearing calculations — ADRAH Farms
 *
 * The first twenty weeks, when a layer flock is all cost and no revenue, and
 * when the decisions that cap its lifetime performance are made.
 *
 * Everything here is pure and configurable. Nothing prescribes: the brooding
 * curve and the body-weight standards are defaults and inputs, replaced by the
 * numbers in your breed's own management guide and your vet's advice.
 */

// ---------------------------------------------------------------------------
// BROODING TEMPERATURE
// ---------------------------------------------------------------------------

export interface BroodingCurve {
  /** House temperature on day 0, in °C. */
  startC: number;
  /** How much it comes down each week. */
  dropPerWeekC: number;
  /** The floor it settles at — ambient house temperature. */
  floorC: number;
  /** How far either side of target counts as "close enough". */
  toleranceC: number;
}

/**
 * Standard practice for chicks: start warm and step down about 3°C a week until
 * the house reaches ambient at around week four.
 *
 * These are the widely used husbandry figures, kept here as DEFAULTS so a farm
 * can replace them. The birds themselves are the better instrument — chicks
 * huddled under the heat are cold, chicks pressed to the walls are too hot — and
 * the observation field on the daily record is there for exactly that.
 */
export const DEFAULT_BROODING_CURVE: BroodingCurve = {
  startC: 34,
  dropPerWeekC: 3,
  floorC: 21,
  toleranceC: 2,
};

/** Target house temperature for a flock of this age. */
export function broodingTargetC(
  ageDays: number,
  curve: BroodingCurve = DEFAULT_BROODING_CURVE,
): number {
  if (ageDays < 0) return curve.startC;
  const weeks = ageDays / 7;
  const target = curve.startC - weeks * curve.dropPerWeekC;
  return Math.max(curve.floorC, Math.round(target * 10) / 10);
}

export type TemperatureVerdict = 'cold' | 'ok' | 'hot';

/** How an actual reading compares with the target for that age. */
export function assessTemperature(
  actualC: number,
  ageDays: number,
  curve: BroodingCurve = DEFAULT_BROODING_CURVE,
): { target: number; difference: number; verdict: TemperatureVerdict } {
  const target = broodingTargetC(ageDays, curve);
  const difference = Math.round((actualC - target) * 10) / 10;
  const verdict: TemperatureVerdict =
    difference < -curve.toleranceC ? 'cold' : difference > curve.toleranceC ? 'hot' : 'ok';
  return { target, difference, verdict };
}

/** Brooding is over once the curve has reached its floor. */
export function isBroodingAge(
  ageDays: number,
  curve: BroodingCurve = DEFAULT_BROODING_CURVE,
): boolean {
  return broodingTargetC(ageDays, curve) > curve.floorC;
}

// ---------------------------------------------------------------------------
// LIFECYCLE STAGE
// ---------------------------------------------------------------------------

export interface StageWindow {
  id: string;
  key: string;
  name: string;
  sequence: number;
  typicalStartAgeDays: number | null;
  typicalEndAgeDays: number | null;
}

/**
 * Which stage a flock of this age would normally be in.
 *
 * A SUGGESTION, never an automatic change. Stage transitions are real husbandry
 * decisions — moving to layer feed, changing the lighting programme — and the
 * farm makes them by looking at the birds, not the calendar. The system's job is
 * to notice when the calendar and the record have drifted apart and say so.
 */
export function suggestedStage(ageDays: number, stages: StageWindow[]): StageWindow | null {
  if (stages.length === 0) return null;
  const ordered = [...stages].sort((a, b) => a.sequence - b.sequence);

  const match = ordered.find((stage) => {
    const start = stage.typicalStartAgeDays;
    const end = stage.typicalEndAgeDays;
    if (start === null) return false;
    if (ageDays < start) return false;
    return end === null || ageDays <= end;
  });
  if (match) return match;

  // Older than every configured window — the last stage is where it belongs.
  const last = ordered[ordered.length - 1];
  const lastStart = last.typicalStartAgeDays;
  if (lastStart !== null && ageDays >= lastStart) return last;

  return ordered[0];
}

export interface StageDrift {
  current: StageWindow | null;
  suggested: StageWindow | null;
  /** True when the flock is recorded in an earlier stage than its age implies. */
  overdue: boolean;
  /** How long it has been past the suggested stage's start, in days. */
  daysOverdue: number;
}

/**
 * Compare where a flock IS recorded against where its age says it should be.
 *
 * Only a move FORWARD counts as overdue. A flock deliberately held back — birds
 * light for their age, a delayed lighting programme — is a decision, not a
 * mistake, and the system should not nag about it in the other direction.
 */
export function stageDrift(
  ageDays: number,
  currentStageId: string | null,
  stages: StageWindow[],
): StageDrift {
  const ordered = [...stages].sort((a, b) => a.sequence - b.sequence);
  const current = ordered.find((s) => s.id === currentStageId) ?? null;
  const suggested = suggestedStage(ageDays, ordered);

  if (!current || !suggested || current.id === suggested.id) {
    return { current, suggested, overdue: false, daysOverdue: 0 };
  }

  const overdue = suggested.sequence > current.sequence;
  const start = suggested.typicalStartAgeDays;
  return {
    current,
    suggested,
    overdue,
    daysOverdue: overdue && start !== null ? Math.max(0, ageDays - start) : 0,
  };
}

// ---------------------------------------------------------------------------
// BODY WEIGHT STANDARD
// ---------------------------------------------------------------------------

/**
 * A breed's target body weight, as age-in-days → grams.
 *
 * Deliberately EMPTY by default. These numbers come from the breed's own
 * management guide — Isa, Lohmann, Hy-Line and Bovans all publish them — and
 * inventing plausible-looking figures would be worse than having none, because
 * they would be trusted and acted on.
 *
 * Stored in `ProductionTypeProfile.standards.bodyWeightByAgeDays`.
 */
export type WeightStandard = Record<number, number>;

/**
 * Target weight at an age, interpolating linearly between published points.
 *
 * Guides publish weekly figures; samples get taken on whatever day suits the
 * farm. Straight-line interpolation between two weekly points is accurate
 * enough for the judgement being made — is this flock on target, or behind.
 *
 * Returns null outside the published range rather than extrapolating. A guess
 * beyond the data is exactly the kind of number that later gets quoted as fact.
 */
export function standardWeightAt(ageDays: number, standard: WeightStandard): number | null {
  const points = Object.entries(standard)
    .map(([age, grams]) => ({ age: Number(age), grams }))
    .filter((p) => Number.isFinite(p.age) && Number.isFinite(p.grams))
    .sort((a, b) => a.age - b.age);

  if (points.length === 0) return null;
  if (ageDays < points[0].age || ageDays > points[points.length - 1].age) return null;

  const exact = points.find((p) => p.age === ageDays);
  if (exact) return exact.grams;

  const after = points.findIndex((p) => p.age > ageDays);
  const lower = points[after - 1];
  const upper = points[after];
  const span = upper.age - lower.age;
  if (span === 0) return lower.grams;

  const ratio = (ageDays - lower.age) / span;
  return Math.round(lower.grams + ratio * (upper.grams - lower.grams));
}

/** Read a weight standard out of a production type's configured standards. */
export function weightStandardFrom(standards: unknown): WeightStandard {
  if (!standards || typeof standards !== 'object') return {};
  const raw = (standards as Record<string, unknown>).bodyWeightByAgeDays;
  if (!raw || typeof raw !== 'object') return {};

  const out: WeightStandard = {};
  for (const [age, grams] of Object.entries(raw as Record<string, unknown>)) {
    const a = Number(age);
    const g = Number(grams);
    if (Number.isFinite(a) && Number.isFinite(g) && a >= 0 && g > 0) out[a] = g;
  }
  return out;
}

/** Read the brooding curve out of configured standards, falling back to defaults. */
export function broodingCurveFrom(standards: unknown): BroodingCurve {
  if (!standards || typeof standards !== 'object') return DEFAULT_BROODING_CURVE;
  const raw = (standards as Record<string, unknown>).broodingCurve;
  if (!raw || typeof raw !== 'object') return DEFAULT_BROODING_CURVE;

  const s = raw as Record<string, unknown>;
  const num = (key: keyof BroodingCurve) =>
    typeof s[key] === 'number' && Number.isFinite(s[key])
      ? (s[key] as number)
      : DEFAULT_BROODING_CURVE[key];

  return {
    startC: num('startC'),
    dropPerWeekC: num('dropPerWeekC'),
    floorC: num('floorC'),
    toleranceC: num('toleranceC'),
  };
}

/**
 * Uniformity verdict, using the target CV% from configuration.
 *
 * Low CV is the goal. A flock that comes into lay ragged peaks lower and holds
 * peak for less time, and no amount of good laying-house management fixes it
 * afterwards — which is why this is measured weekly through rearing rather than
 * once at the end.
 */
export function assessUniformity(
  cvPct: number | null,
  targetCvPct = 10,
): 'good' | 'watch' | 'poor' | null {
  if (cvPct === null) return null;
  if (cvPct <= targetCvPct) return 'good';
  if (cvPct <= targetCvPct * 1.5) return 'watch';
  return 'poor';
}

// ---------------------------------------------------------------------------
// WHAT THE CHICKS ARE DOING
// ---------------------------------------------------------------------------

/**
 * Chick behaviour under the brooder.
 *
 * The oldest and best diagnostic in poultry keeping. A thermometer reads the air
 * where it happens to hang; the birds read the temperature where they actually
 * are, and they show you the answer without being asked.
 */
export const CHICK_BEHAVIOURS = [
  {
    key: 'spread_evenly',
    label: 'Spread evenly, active',
    meaning: 'Comfortable — this is what you want.',
    implies: 'ok',
  },
  {
    key: 'huddled',
    label: 'Huddled under the heat',
    meaning: 'Too cold. Chicks pile for warmth, and the ones underneath suffocate.',
    implies: 'cold',
  },
  {
    key: 'at_walls',
    label: 'Pressed against the walls',
    meaning: 'Too hot. They are escaping the heat source.',
    implies: 'hot',
  },
  {
    key: 'panting',
    label: 'Panting, wings out',
    meaning: 'Much too hot, and already losing condition.',
    implies: 'hot',
  },
  {
    key: 'one_side',
    label: 'Crowded to one side',
    meaning: 'A draught. Find where the air is coming in.',
    implies: 'draught',
  },
] as const;

export type ChickBehaviourKey = (typeof CHICK_BEHAVIOURS)[number]['key'];

export function chickBehaviour(key: string | null | undefined) {
  if (!key) return null;
  return CHICK_BEHAVIOURS.find((b) => b.key === key) ?? null;
}

/** Litter condition. Wet litter is where coccidiosis starts. */
export const LITTER_CONDITIONS = [
  { key: 'dry', label: 'Dry and friable', concern: false },
  { key: 'damp', label: 'Damp in places', concern: true },
  { key: 'wet', label: 'Wet', concern: true },
  { key: 'caked', label: 'Caked', concern: true },
] as const;

export function litterCondition(key: string | null | undefined) {
  if (!key) return null;
  return LITTER_CONDITIONS.find((l) => l.key === key) ?? null;
}
