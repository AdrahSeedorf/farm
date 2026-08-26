import { describe, it, expect } from 'vitest';
import {
  broodingTargetC,
  assessTemperature,
  isBroodingAge,
  suggestedStage,
  stageDrift,
  standardWeightAt,
  weightStandardFrom,
  broodingCurveFrom,
  assessUniformity,
  DEFAULT_BROODING_CURVE,
  type StageWindow,
} from '../rearing';

describe('brooding temperature', () => {
  it('starts warm and steps down about 3°C a week', () => {
    expect(broodingTargetC(0)).toBe(34);
    expect(broodingTargetC(7)).toBe(31);
    expect(broodingTargetC(14)).toBe(28);
    expect(broodingTargetC(21)).toBe(25);
  });

  it('settles at ambient and stays there', () => {
    expect(broodingTargetC(28)).toBe(22);
    expect(broodingTargetC(35)).toBe(21);
    expect(broodingTargetC(200)).toBe(21);
  });

  it('interpolates between whole weeks', () => {
    // half a week down from 34 is 32.5
    expect(broodingTargetC(3.5)).toBe(32.5);
  });

  it('judges a reading against the target for that age', () => {
    expect(assessTemperature(31, 7).verdict).toBe('ok');
    expect(assessTemperature(26, 7).verdict).toBe('cold');
    expect(assessTemperature(35, 7).verdict).toBe('hot');
  });

  it('allows a tolerance either side rather than demanding a number', () => {
    // target at day 7 is 31, tolerance 2
    expect(assessTemperature(29, 7).verdict).toBe('ok');
    expect(assessTemperature(33, 7).verdict).toBe('ok');
    expect(assessTemperature(28.9, 7).verdict).toBe('cold');
  });

  it('reports the gap, so the message can be specific', () => {
    const r = assessTemperature(27, 7);
    expect(r.target).toBe(31);
    expect(r.difference).toBe(-4);
  });

  it('knows when brooding is over', () => {
    expect(isBroodingAge(3)).toBe(true);
    expect(isBroodingAge(21)).toBe(true);
    expect(isBroodingAge(40)).toBe(false);
  });

  it("honours a farm's own curve over the defaults", () => {
    const curve = { startC: 32, dropPerWeekC: 2, floorC: 24, toleranceC: 1 };
    expect(broodingTargetC(7, curve)).toBe(30);
    expect(broodingTargetC(70, curve)).toBe(24);
    expect(assessTemperature(31.5, 7, curve).verdict).toBe('hot');
  });

  it('reads a curve from configuration, falling back per field', () => {
    expect(broodingCurveFrom(null)).toEqual(DEFAULT_BROODING_CURVE);
    expect(broodingCurveFrom({ broodingCurve: { startC: 33 } }).startC).toBe(33);
    expect(broodingCurveFrom({ broodingCurve: { startC: 33 } }).floorC).toBe(
      DEFAULT_BROODING_CURVE.floorC,
    );
  });
});

const STAGES: StageWindow[] = [
  { id: 'b', key: 'brooding', name: 'Brooding', sequence: 1, typicalStartAgeDays: 0, typicalEndAgeDays: 28 },
  { id: 'g', key: 'growing', name: 'Growing', sequence: 2, typicalStartAgeDays: 29, typicalEndAgeDays: 112 },
  { id: 'p', key: 'pre_lay', name: 'Pre-lay', sequence: 3, typicalStartAgeDays: 113, typicalEndAgeDays: 133 },
  { id: 'l', key: 'laying', name: 'Laying', sequence: 4, typicalStartAgeDays: 134, typicalEndAgeDays: 525 },
  { id: 'd', key: 'depleting', name: 'Depleting', sequence: 5, typicalStartAgeDays: 526, typicalEndAgeDays: null },
];

describe('lifecycle stage suggestion', () => {
  it('picks the stage whose window contains the age', () => {
    expect(suggestedStage(3, STAGES)?.key).toBe('brooding');
    expect(suggestedStage(60, STAGES)?.key).toBe('growing');
    expect(suggestedStage(120, STAGES)?.key).toBe('pre_lay');
    expect(suggestedStage(200, STAGES)?.key).toBe('laying');
  });

  it('handles the boundaries exactly', () => {
    expect(suggestedStage(28, STAGES)?.key).toBe('brooding');
    expect(suggestedStage(29, STAGES)?.key).toBe('growing');
  });

  it('puts a very old flock in the final stage rather than nowhere', () => {
    expect(suggestedStage(900, STAGES)?.key).toBe('depleting');
  });

  it('returns null when no stages are configured', () => {
    expect(suggestedStage(30, [])).toBeNull();
  });
});

describe('stage drift', () => {
  it('says nothing when the record matches the age', () => {
    const d = stageDrift(60, 'g', STAGES);
    expect(d.overdue).toBe(false);
    expect(d.suggested?.key).toBe('growing');
  });

  it('flags the flock still recorded as Brooding at day 151', () => {
    // The exact gap the earlier screenshot exposed.
    const d = stageDrift(151, 'b', STAGES);
    expect(d.overdue).toBe(true);
    expect(d.current?.key).toBe('brooding');
    expect(d.suggested?.key).toBe('laying');
    expect(d.daysOverdue).toBe(17);
  });

  it('does NOT nag when a flock is deliberately held back', () => {
    // Recorded further along than its age suggests — a decision, not a mistake.
    const d = stageDrift(30, 'l', STAGES);
    expect(d.overdue).toBe(false);
  });

  it('is quiet when the flock has no stage recorded at all', () => {
    expect(stageDrift(60, null, STAGES).overdue).toBe(false);
  });
});

describe('body weight standard', () => {
  // Shaped like a real management guide: weekly points.
  const guide = { 0: 40, 7: 70, 14: 115, 21: 170, 28: 240, 35: 320 };

  it('returns a published point exactly', () => {
    expect(standardWeightAt(14, guide)).toBe(115);
  });

  it('interpolates between weekly points', () => {
    // halfway between 115 and 170
    expect(standardWeightAt(17.5, guide)).toBe(143);
  });

  it('REFUSES to extrapolate beyond the published range', () => {
    // A guess past the data becomes a quoted fact later. Better to show nothing.
    expect(standardWeightAt(60, guide)).toBeNull();
    expect(standardWeightAt(-1, guide)).toBeNull();
  });

  it('returns null when no standard has been loaded', () => {
    expect(standardWeightAt(14, {})).toBeNull();
  });

  it('reads a standard from configuration and discards junk', () => {
    const s = weightStandardFrom({
      bodyWeightByAgeDays: { 7: 70, 14: 115, bad: 'x', 21: -5 },
    });
    expect(s).toEqual({ 7: 70, 14: 115 });
  });

  it('defaults to empty rather than inventing a curve', () => {
    expect(weightStandardFrom(null)).toEqual({});
    expect(weightStandardFrom({ note: 'not configured' })).toEqual({});
  });
});

describe('uniformity verdict', () => {
  it('rates a tight flock well', () => {
    expect(assessUniformity(7)).toBe('good');
    expect(assessUniformity(10)).toBe('good');
  });

  it('warns in the middle band', () => {
    expect(assessUniformity(13)).toBe('watch');
  });

  it('calls out a ragged flock', () => {
    expect(assessUniformity(22)).toBe('poor');
  });

  it('respects a tightened target', () => {
    expect(assessUniformity(9, 8)).toBe('watch');
  });

  it('says nothing without a measurement', () => {
    expect(assessUniformity(null)).toBeNull();
  });
});
