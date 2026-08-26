import { describe, it, expect } from 'vitest';
import { dailyRecordSchema } from '../validation/daily';

const today = new Date().toISOString().slice(0, 10);
const base = { onDate: today, idempotencyKey: 'abcdefgh12345678' };

const parse = (extra: Record<string, string>) =>
  dailyRecordSchema.safeParse({ ...base, ...extra });

describe('daily record validation', () => {
  it('accepts a morning where nothing is entered at all', () => {
    const r = parse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.mortality).toBe(0);
      expect(r.data.culls).toBe(0);
    }
  });

  describe('blank is not zero', () => {
    // z.coerce.number() turns "" into 0. For a measured quantity that is a lie:
    // "no feed given" and "feed not measured" are different facts, and treating
    // the second as zero drags every feed average down permanently.
    it('stores an unmeasured quantity as null, NOT zero', () => {
      const r = parse({ feedKg: '', waterLitres: '' });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.feedKg).toBeNull();
        expect(r.data.waterLitres).toBeNull();
      }
    });

    it('keeps a deliberate zero as zero', () => {
      const r = parse({ feedKg: '0' });
      expect(r.success && r.data.feedKg).toBe(0);
    });

    it('treats a blank bird count as none, which is correct there', () => {
      const r = parse({ mortality: '' });
      expect(r.success && r.data.mortality).toBe(0);
    });

    it('reads a real measurement', () => {
      const r = parse({ feedKg: '214.5', waterLitres: '430' });
      expect(r.success && r.data.feedKg).toBe(214.5);
      expect(r.success && r.data.waterLitres).toBe(430);
    });
  });

  describe('counts', () => {
    it('rejects fractional birds', () => {
      expect(parse({ mortality: '2.5' }).success).toBe(false);
    });
    it('rejects negative birds', () => {
      expect(parse({ mortality: '-3' }).success).toBe(false);
    });
    it('accepts a large but plausible loss', () => {
      expect(parse({ mortality: '450' }).success).toBe(true);
    });
  });

  describe('measures', () => {
    it('rejects a negative quantity', () => {
      expect(parse({ feedKg: '-5' }).success).toBe(false);
    });
    it('rejects text', () => {
      expect(parse({ feedKg: 'two bags' }).success).toBe(false);
    });
  });

  describe('dates', () => {
    it('rejects a future date', () => {
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      expect(parse({ onDate: tomorrow }).success).toBe(false);
    });
    it('accepts a past date, for catching up', () => {
      const lastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
      expect(parse({ onDate: lastWeek }).success).toBe(true);
    });
  });

  describe('idempotency key', () => {
    it('is required — it is the defence against a phone retrying', () => {
      const r = dailyRecordSchema.safeParse({ onDate: today });
      expect(r.success).toBe(false);
    });
    it('rejects a key too short to be unique', () => {
      expect(dailyRecordSchema.safeParse({ onDate: today, idempotencyKey: 'abc' }).success).toBe(
        false,
      );
    });
  });

  it('reads the warning acknowledgement from a checkbox value', () => {
    expect(parse({ acknowledgeWarnings: 'on' }).success && parse({ acknowledgeWarnings: 'on' }).data?.acknowledgeWarnings).toBe(true);
    expect(parse({}).success && parse({}).data?.acknowledgeWarnings).toBe(false);
  });
});
