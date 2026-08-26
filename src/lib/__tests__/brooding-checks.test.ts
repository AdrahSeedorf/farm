import { describe, it, expect } from 'vitest';
import { checkDailyRecord } from '../daily-checks';

const base = { population: 2000, ageDays: 7, mortality: 0, culls: 0 };
const messages = (w: { message: string }[]) => w.map((x) => x.message).join(' | ');

describe('brooding checks on the daily record', () => {
  it('says nothing when the house is on target and the chicks are settled', () => {
    // Day 7 target is 31°C
    expect(
      checkDailyRecord({ ...base, broodTempC: 31, chickBehaviour: 'spread_evenly' }),
    ).toEqual([]);
  });

  it('flags a cold house and says why it matters', () => {
    const w = checkDailyRecord({ ...base, broodTempC: 26 });
    expect(messages(w)).toMatch(/below the 31°C target for day 7/);
    expect(messages(w)).toMatch(/pile/);
  });

  it('flags a hot house', () => {
    expect(messages(checkDailyRecord({ ...base, broodTempC: 36 }))).toMatch(/above the 31°C/);
  });

  it('follows the curve as the flock ages', () => {
    // 26°C is cold at day 7 but fine at day 21 (target 25°C)
    expect(checkDailyRecord({ ...base, ageDays: 7, broodTempC: 26 }).length).toBe(1);
    expect(checkDailyRecord({ ...base, ageDays: 21, broodTempC: 26 })).toEqual([]);
  });

  describe('what the chicks are doing', () => {
    it('reads huddling as cold and explains the danger', () => {
      expect(messages(checkDailyRecord({ ...base, chickBehaviour: 'huddled' }))).toMatch(
        /Too cold.*suffocate/,
      );
    });

    it('reads birds at the walls as too hot', () => {
      expect(messages(checkDailyRecord({ ...base, chickBehaviour: 'at_walls' }))).toMatch(
        /Too hot/,
      );
    });

    it('reads crowding to one side as a draught', () => {
      expect(messages(checkDailyRecord({ ...base, chickBehaviour: 'one_side' }))).toMatch(
        /draught/i,
      );
    });

    it('says nothing when they are spread evenly', () => {
      expect(checkDailyRecord({ ...base, chickBehaviour: 'spread_evenly' })).toEqual([]);
    });
  });

  describe('when the birds and the thermometer disagree', () => {
    // A wall thermometer reads the air where it hangs. The chicks read the
    // temperature where they actually are.
    it('says to trust the birds and check the thermometer', () => {
      const w = checkDailyRecord({ ...base, broodTempC: 31, chickBehaviour: 'huddled' });
      expect(messages(w)).toMatch(/Trust the birds/);
      expect(messages(w)).toMatch(/where the thermometer is hanging/);
    });

    it('does not raise the contradiction when both agree it is cold', () => {
      const w = checkDailyRecord({ ...base, broodTempC: 26, chickBehaviour: 'huddled' });
      expect(messages(w)).not.toMatch(/Trust the birds/);
    });

    it('does not raise it for a draught, which a thermometer cannot see anyway', () => {
      const w = checkDailyRecord({ ...base, broodTempC: 31, chickBehaviour: 'one_side' });
      expect(messages(w)).not.toMatch(/Trust the birds/);
      expect(messages(w)).toMatch(/draught/i);
    });
  });

  describe('litter', () => {
    it('says nothing about dry litter', () => {
      expect(checkDailyRecord({ ...base, litterCondition: 'dry' })).toEqual([]);
    });

    it('flags wet or caked litter as where coccidiosis starts', () => {
      expect(messages(checkDailyRecord({ ...base, litterCondition: 'wet' }))).toMatch(
        /coccidiosis/,
      );
      expect(messages(checkDailyRecord({ ...base, litterCondition: 'caked' }))).toMatch(
        /coccidiosis/,
      );
      expect(messages(checkDailyRecord({ ...base, litterCondition: 'damp' }))).toMatch(
        /coccidiosis/,
      );
    });
  });

  it('ignores an unrecognised value rather than inventing a warning', () => {
    expect(checkDailyRecord({ ...base, chickBehaviour: 'dancing' })).toEqual([]);
    expect(checkDailyRecord({ ...base, litterCondition: 'sparkling' })).toEqual([]);
  });

  it('honours a farm-specific brooding curve', () => {
    const curve = { startC: 30, dropPerWeekC: 2, floorC: 22, toleranceC: 1 };
    // Day 7 target becomes 28°C, so 31 is now hot rather than on target
    expect(
      messages(checkDailyRecord({ ...base, broodTempC: 31, broodingCurve: curve })),
    ).toMatch(/above the 28°C/);
  });
});
