import { describe, it, expect } from 'vitest';
import {
  deltaFor,
  populationAsOf,
  dayPopulation,
  deathsBetween,
  assertLedgerCoherent,
  populationSeries,
  LedgerError,
  type PopulationEvent,
  type AnimalGroupEventType,
} from '../ledger';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const ev = (
  type: AnimalGroupEventType,
  quantity: number,
  occurredOn: string,
): PopulationEvent => ({
  type,
  delta: deltaFor(type, quantity),
  occurredOn: d(occurredOn),
});

describe('deltaFor — the only place an event sign is decided', () => {
  it('adds birds for placements and transfers in', () => {
    expect(deltaFor('PLACEMENT', 2000)).toBe(2000);
    expect(deltaFor('TRANSFER_IN', 50)).toBe(50);
  });

  it('removes birds for mortality, culls, sales and transfers out', () => {
    expect(deltaFor('MORTALITY', 6)).toBe(-6);
    expect(deltaFor('CULL', 3)).toBe(-3);
    expect(deltaFor('SALE', 100)).toBe(-100);
    expect(deltaFor('TRANSFER_OUT', 20)).toBe(-20);
  });

  it('refuses a negative quantity — the event type carries the direction', () => {
    // Guards against a caller "helpfully" passing -6 deaths, which would
    // otherwise resurrect six birds.
    expect(() => deltaFor('MORTALITY', -6)).toThrow(/positive quantity/);
    expect(() => deltaFor('PLACEMENT', 0)).toThrow(/positive quantity/);
  });

  it('accepts a signed value only for ADJUSTMENT, which may go either way', () => {
    expect(deltaFor('ADJUSTMENT', -4)).toBe(-4);
    expect(deltaFor('ADJUSTMENT', 4)).toBe(4);
    expect(() => deltaFor('ADJUSTMENT', 0)).toThrow(/records nothing/);
  });

  it('keeps STAGE_CHANGE population-neutral', () => {
    expect(deltaFor('STAGE_CHANGE', 0)).toBe(0);
    expect(() => deltaFor('STAGE_CHANGE', 5)).toThrow(/must not move population/);
  });

  it('rejects fractional animals', () => {
    expect(() => deltaFor('MORTALITY', 1.5)).toThrow(/whole number/);
  });
});

describe('population is derived from the ledger', () => {
  const flock: PopulationEvent[] = [
    ev('PLACEMENT', 2000, '2027-01-01'),
    ev('MORTALITY', 15, '2027-01-03'), // brooding losses
    ev('MORTALITY', 8, '2027-01-10'),
    ev('CULL', 5, '2027-02-01'),
    ev('MORTALITY', 4, '2027-03-15'),
    ev('SALE', 100, '2027-06-01'),
  ];

  it('sums to the current population', () => {
    expect(populationAsOf(flock)).toBe(1868);
  });

  it('answers "how many birds did we have on that date"', () => {
    expect(populationAsOf(flock, d('2027-01-01'))).toBe(2000);
    expect(populationAsOf(flock, d('2027-01-02'))).toBe(2000);
    expect(populationAsOf(flock, d('2027-01-03'))).toBe(1985);
    expect(populationAsOf(flock, d('2027-02-01'))).toBe(1972);
    expect(populationAsOf(flock, d('2027-12-31'))).toBe(1868);
  });

  it('gives opening and closing counts for a single day', () => {
    const day = dayPopulation(flock, d('2027-01-03'));
    expect(day.opening).toBe(2000);
    expect(day.closing).toBe(1985);
    expect(day.deaths).toBe(15);
    expect(day.sold).toBe(0);
  });

  it('counts a sale day separately from a death day', () => {
    const day = dayPopulation(flock, d('2027-06-01'));
    expect(day.deaths).toBe(0);
    expect(day.sold).toBe(100);
  });

  it('counts mortality and culls together as deaths over a window', () => {
    expect(deathsBetween(flock, d('2027-01-01'), d('2027-01-31'))).toBe(23);
    expect(deathsBetween(flock, d('2027-01-01'), d('2027-12-31'))).toBe(32);
    expect(deathsBetween(flock, d('2027-04-01'), d('2027-05-01'))).toBe(0);
  });

  it('is unaffected by the order events were written in', () => {
    const shuffled = [...flock].reverse();
    expect(populationAsOf(shuffled)).toBe(populationAsOf(flock));
  });
});

describe('corrections are new events, never edits', () => {
  it('applies a recount as an ADJUSTMENT that leaves history intact', () => {
    const events: PopulationEvent[] = [
      ev('PLACEMENT', 2000, '2027-01-01'),
      ev('MORTALITY', 10, '2027-01-05'),
    ];
    expect(populationAsOf(events)).toBe(1990);

    // A physical recount finds 1,987. We do NOT edit the mortality row.
    events.push(ev('ADJUSTMENT', -3, '2027-01-06'));

    expect(populationAsOf(events)).toBe(1987);
    // The original mortality figure is still exactly what was reported
    expect(deathsBetween(events, d('2027-01-01'), d('2027-01-31'))).toBe(10);
    // and the pre-correction history is unchanged
    expect(populationAsOf(events, d('2027-01-05'))).toBe(1990);
  });
});

describe('ledger coherence', () => {
  it('accepts a well-formed ledger', () => {
    expect(() =>
      assertLedgerCoherent([
        ev('PLACEMENT', 100, '2027-01-01'),
        ev('MORTALITY', 5, '2027-01-02'),
      ]),
    ).not.toThrow();
  });

  it('shouts when more birds leave than ever arrived', () => {
    // Almost always a mortality recorded against the wrong flock. This must be
    // loud, not silently clamped to zero.
    expect(() =>
      assertLedgerCoherent([
        ev('PLACEMENT', 10, '2027-01-01'),
        ev('MORTALITY', 12, '2027-01-02'),
      ]),
    ).toThrow(LedgerError);
  });

  it('detects incoherence even when events are stored out of order', () => {
    expect(() =>
      assertLedgerCoherent([
        ev('MORTALITY', 12, '2027-01-02'),
        ev('PLACEMENT', 10, '2027-01-03'),
      ]),
    ).toThrow(/below zero/);
  });
});

describe('population across a run of days', () => {
  /** A placement, then two deaths on separate days. */
  const events: PopulationEvent[] = [
    { type: 'PLACEMENT', delta: 1000, occurredOn: d('2027-01-01') },
    { type: 'MORTALITY', delta: -6, occurredOn: d('2027-01-03') },
    { type: 'MORTALITY', delta: -4, occurredOn: d('2027-01-03') },
    { type: 'SALE', delta: -100, occurredOn: d('2027-01-05') },
  ];

  const days = [d('2027-01-01'), d('2027-01-02'), d('2027-01-03'), d('2027-01-04'), d('2027-01-05')];

  it('carries the running total forward from day to day', () => {
    expect(populationSeries(events, days)).toEqual([
      { onDate: d('2027-01-01'), opening: 0, closing: 1000 },
      { onDate: d('2027-01-02'), opening: 1000, closing: 1000 },
      { onDate: d('2027-01-03'), opening: 1000, closing: 990 },
      { onDate: d('2027-01-04'), opening: 990, closing: 990 },
      { onDate: d('2027-01-05'), opening: 990, closing: 890 },
    ]);
  });

  it('AGREES WITH dayPopulation, which is the slow way of asking the same thing', () => {
    for (const day of days) {
      const one = dayPopulation(events, day);
      const many = populationSeries(events, [day])[0];
      expect(many.opening).toBe(one.opening);
      expect(many.closing).toBe(one.closing);
    }
  });

  it('sorts the days it is given rather than trusting their order', () => {
    const reversed = populationSeries(events, [d('2027-01-05'), d('2027-01-01')]);
    expect(reversed.map((r) => r.closing)).toEqual([1000, 890]);
  });

  it('is nothing at all when no days are asked for', () => {
    expect(populationSeries(events, [])).toEqual([]);
  });

  it('reports a day before anything happened as an empty flock', () => {
    expect(populationSeries(events, [d('2026-12-25')])).toEqual([
      { onDate: d('2026-12-25'), opening: 0, closing: 0 },
    ]);
  });
});
