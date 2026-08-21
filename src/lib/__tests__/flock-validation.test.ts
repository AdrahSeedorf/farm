import { describe, it, expect } from 'vitest';
import { placementSchema, flockEventSchema } from '../validation/flock';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const daysAhead = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

const validPlacement = {
  code: 'FLK-2026-01',
  productionUnitId: 'unit-1',
  dateOfHatch: daysAgo(30),
  arrivalDate: daysAgo(29),
  quantity: '2000',
  deadOnArrival: '15',
};

describe('placement validation', () => {
  it('accepts a normal placement', () => {
    const result = placementSchema.safeParse(validPlacement);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quantity).toBe(2000);
      expect(result.data.code).toBe('FLK-2026-01');
    }
  });

  it('uppercases the code so references stay consistent', () => {
    const result = placementSchema.safeParse({ ...validPlacement, code: 'flk-2026-02' });
    expect(result.success && result.data.code).toBe('FLK-2026-02');
  });

  describe('future dates', () => {
    // The `max` attribute on a date input is a courtesy, not a control. A hatch
    // date typed as next year gives the flock a NEGATIVE age, and age drives
    // vaccination scheduling, lay curves and body-weight targets.
    it('REJECTS a hatch date in the future', () => {
      const result = placementSchema.safeParse({
        ...validPlacement,
        dateOfHatch: daysAhead(200),
        arrivalDate: daysAhead(201),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(JSON.stringify(result.error.issues)).toMatch(/in the future/);
      }
    });

    it('REJECTS an arrival date in the future', () => {
      const result = placementSchema.safeParse({
        ...validPlacement,
        arrivalDate: daysAhead(1),
      });
      expect(result.success).toBe(false);
    });

    it('accepts today', () => {
      const result = placementSchema.safeParse({
        ...validPlacement,
        dateOfHatch: daysAgo(0),
        arrivalDate: daysAgo(0),
      });
      expect(result.success).toBe(true);
    });

    it('REJECTS a future event date', () => {
      const result = flockEventSchema.safeParse({
        type: 'MORTALITY',
        quantity: '4',
        occurredOn: daysAhead(1),
      });
      expect(result.success).toBe(false);
    });
  });

  it('refuses birds that arrived before they hatched', () => {
    const result = placementSchema.safeParse({
      ...validPlacement,
      dateOfHatch: daysAgo(10),
      arrivalDate: daysAgo(12),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toMatch(/before they hatched/);
    }
  });

  it('refuses more dead on arrival than were received', () => {
    const result = placementSchema.safeParse({
      ...validPlacement,
      quantity: '100',
      deadOnArrival: '101',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toMatch(/cannot exceed/);
    }
  });

  it('refuses fractional and zero birds', () => {
    expect(placementSchema.safeParse({ ...validPlacement, quantity: '1.5' }).success).toBe(false);
    expect(placementSchema.safeParse({ ...validPlacement, quantity: '0' }).success).toBe(false);
    expect(placementSchema.safeParse({ ...validPlacement, quantity: '-5' }).success).toBe(false);
  });

  it('refuses a code with characters that break references and exports', () => {
    expect(placementSchema.safeParse({ ...validPlacement, code: 'FLK 2026/01' }).success).toBe(
      false,
    );
  });
});

describe('flock event validation', () => {
  it('accepts mortality with a reason', () => {
    const result = flockEventSchema.safeParse({
      type: 'MORTALITY',
      quantity: '6',
      occurredOn: daysAgo(1),
      reasonCode: 'chilling',
      notes: 'Brooder went out overnight',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.quantity).toBe(6);
  });

  it('allows a negative quantity through the schema so corrections can use it', () => {
    // Direction is enforced by event type in the action, not here — the schema
    // only rejects a quantity of zero, which records nothing.
    expect(
      flockEventSchema.safeParse({ type: 'ADJUSTMENT', quantity: '-4', occurredOn: daysAgo(0) })
        .success,
    ).toBe(true);
    expect(
      flockEventSchema.safeParse({ type: 'MORTALITY', quantity: '0', occurredOn: daysAgo(0) })
        .success,
    ).toBe(false);
  });

  it('rejects an unknown reason code', () => {
    expect(
      flockEventSchema.safeParse({
        type: 'MORTALITY',
        quantity: '1',
        occurredOn: daysAgo(0),
        reasonCode: 'made_up',
      }).success,
    ).toBe(false);
  });

  it('rejects an event type that is not a real ledger event', () => {
    expect(
      flockEventSchema.safeParse({ type: 'PLACEMENT', quantity: '1', occurredOn: daysAgo(0) })
        .success,
    ).toBe(false);
  });
});
