import { describe, it, expect } from 'vitest';
import { activeWithdrawals, clearFor, withdrawalClearsOn } from '../health-schedule';
import { standingFor } from '../health-schedule';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * These exercise the arithmetic the sale gate depends on. The gate itself
 * (`assertSaleAllowed`) is a thin wrapper: it reads the events, calls these, and
 * throws. Everything that could be wrong is wrong here first.
 */
describe('deciding whether produce may be sold', () => {
  const antibiotic = {
    name: 'Antibiotic course',
    occurredOn: d('2026-09-01'),
    eggWithdrawalDays: 7,
    meatWithdrawalDays: 14,
  };

  it('restricts eggs for exactly the stated days', () => {
    // Treated the 1st, 7-day withdrawal: the 7th is the last restricted day.
    expect(clearFor(activeWithdrawals([antibiotic], d('2026-09-07')), 'EGGS')).toEqual(
      d('2026-09-08'),
    );
  });

  it('CLEARS ON THE DAY AFTER, not the day of', () => {
    // On the 8th nothing is in force any more.
    expect(clearFor(activeWithdrawals([antibiotic], d('2026-09-08')), 'EGGS')).toBeNull();
  });

  it('keeps eggs and meat on their own clocks', () => {
    const onTheTenth = activeWithdrawals([antibiotic], d('2026-09-10'));
    expect(clearFor(onTheTenth, 'EGGS')).toBeNull();
    expect(clearFor(onTheTenth, 'MEAT')).toEqual(d('2026-09-15'));
  });

  it('reports how long is left, for a message that says when rather than no', () => {
    const [longest] = activeWithdrawals([antibiotic], d('2026-09-05'));
    expect(longest.kind).toBe('MEAT');
    expect(longest.daysRemaining).toBe(10);
    expect(longest.lastRestrictedDay).toEqual(d('2026-09-14'));
  });

  it('IGNORES A TREATMENT WITH NO WITHDRAWAL RECORDED', () => {
    // Not because none applies — because nobody wrote one down. The warning at
    // recording time is what catches that; the gate cannot invent a period.
    const vaccine = {
      name: 'Newcastle',
      occurredOn: d('2026-09-01'),
      eggWithdrawalDays: null,
      meatWithdrawalDays: null,
    };
    expect(activeWithdrawals([vaccine], d('2026-09-02'))).toEqual([]);
  });

  it('treats a stated zero as no restriction, which is a real answer', () => {
    const vitamin = {
      name: 'Vitamin',
      occurredOn: d('2026-09-01'),
      eggWithdrawalDays: 0,
      meatWithdrawalDays: null,
    };
    expect(clearFor(activeWithdrawals([vitamin], d('2026-09-01')), 'EGGS')).toBeNull();
  });

  describe('overlapping treatments', () => {
    const long = {
      name: 'Long product',
      occurredOn: d('2026-09-01'),
      eggWithdrawalDays: 14,
      meatWithdrawalDays: null,
    };
    const short = {
      name: 'Short product',
      occurredOn: d('2026-09-05'),
      eggWithdrawalDays: 2,
      meatWithdrawalDays: null,
    };

    it('A LATER SHORT WITHDRAWAL NEVER CLEARS AN EARLIER LONG ONE', () => {
      // The failure this prevents puts residue in eggs that went to a customer.
      const active = activeWithdrawals([long, short], d('2026-09-08'));
      expect(clearFor(active, 'EGGS')).toEqual(d('2026-09-15'));
    });

    it('and the short one alone would have cleared on the 7th', () => {
      expect(withdrawalClearsOn(short.occurredOn, short.eggWithdrawalDays)).toEqual(
        d('2026-09-07'),
      );
    });

    it('lists both while both are in force, longest first', () => {
      const active = activeWithdrawals([long, short], d('2026-09-06'));
      expect(active.map((w) => w.name)).toEqual(['Long product', 'Short product']);
    });

    it('drops the short one once it clears, keeping the long one', () => {
      const active = activeWithdrawals([long, short], d('2026-09-08'));
      expect(active.map((w) => w.name)).toEqual(['Long product']);
    });
  });

  it('says nothing about a flock that has had nothing', () => {
    expect(activeWithdrawals([], d('2026-09-08'))).toEqual([]);
    expect(clearFor([], 'EGGS')).toBeNull();
  });
});

/**
 * THE GATE ITSELF.
 *
 * These exist because the comment at the top of this file was wrong. The gate
 * was NOT a thin wrapper over the arithmetic above — it read `eggsClearOn` and
 * returned early when that was null, which is also what null means when nobody
 * recorded a withdrawal period at all. So a flock treated with a product whose
 * label was never read produced eggs that went straight into saleable stock,
 * while the order screen, reading the same data through a different filter,
 * refused to sell a single egg on the farm.
 */
describe('the sale gate', () => {
  const house = (over: Partial<Parameters<typeof standingFor>[0]> = {}) => ({
    flockCode: 'FLK-2026-01',
    houseName: 'House A',
    withdrawals: [],
    unstated: [],
    eggsClearOn: null,
    meatClearsOn: null,
    ...over,
  });

  const unstatedEggs = [
    { name: 'Oxytetracycline', kind: 'EGGS' as const, treatedOn: d('2026-11-02'), daysSince: 1 },
  ];

  it('lets a clean flock sell', () => {
    expect(standingFor(house(), 'EGGS').blocked).toBe(false);
  });

  it('blocks a dated withdrawal and says when it lifts', () => {
    const standing = standingFor(
      house({
        eggsClearOn: d('2026-09-08'),
        withdrawals: activeWithdrawals(
          [
            {
              name: 'Antibiotic course',
              occurredOn: d('2026-09-01'),
              eggWithdrawalDays: 7,
              meatWithdrawalDays: 14,
            },
          ],
          d('2026-09-05'),
        ),
      }),
      'EGGS',
    );
    expect(standing.blocked).toBe(true);
    expect(standing.clearsOn).toEqual(d('2026-09-08'));
    expect(standing.reason).toContain('2026-09-08');
    expect(standing.reason).toContain('Antibiotic course');
  });

  /**
   * THE REGRESSION. A treatment recorded with the withdrawal box left blank.
   * Before the fix this returned "not blocked" and the eggs were banked as
   * saleable with nothing shown on any screen.
   */
  it('BLOCKS a treatment whose withdrawal period nobody recorded', () => {
    const standing = standingFor(house({ unstated: unstatedEggs }), 'EGGS');
    expect(standing.blocked).toBe(true);
  });

  it('gives an unknown period NO clearing date, because it does not lift on its own', () => {
    expect(standingFor(house({ unstated: unstatedEggs }), 'EGGS').clearsOn).toBeNull();
  });

  it('tells somebody what to do about it, naming the product and the house', () => {
    const reason = standingFor(house({ unstated: unstatedEggs }), 'EGGS').reason;
    expect(reason).toContain('House A');
    expect(reason).toContain('Oxytetracycline');
    expect(reason).toContain('reads the label');
  });

  /**
   * An unknown EGG period must not quietly restrict meat, and vice versa. They
   * are separate labels and separate decisions.
   */
  it('keeps an unknown period on its own kind', () => {
    expect(standingFor(house({ unstated: unstatedEggs }), 'MEAT').blocked).toBe(false);
  });

  it('blocks meat whose period nobody recorded', () => {
    const unstatedMeat = [
      { name: 'Ivermectin', kind: 'MEAT' as const, treatedOn: d('2026-11-02'), daysSince: 1 },
    ];
    expect(standingFor(house({ unstated: unstatedMeat }), 'MEAT').blocked).toBe(true);
  });

  /**
   * Unknown wins over a dated period that has already cleared — the silence is
   * still a silence, and it is the restriction with no end.
   */
  it('reports the unknown rather than a cleared date', () => {
    const standing = standingFor(
      house({ unstated: unstatedEggs, eggsClearOn: null }),
      'EGGS',
    );
    expect(standing.clearsOn).toBeNull();
    expect(standing.reason).toContain('Nobody recorded');
  });
});
