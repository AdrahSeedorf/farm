import { describe, it, expect } from 'vitest';
import {
  unitCostPerBase,
  lineTotal,
  roundingDrift,
  blendBatchCost,
  decideBatch,
  suggestBatchNumber,
  checkReceipt,
  ReceivingError,
} from '../receiving';
import { warningToken } from '../warnings';
import { receiptSchema } from '../validation/receipt';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('turning an invoice price into a stored cost', () => {
  it('divides by the pack size, because stock is stored in the base unit', () => {
    // GHS 320 a bag, a bag is 50 kg -> 640 pesewas per kilogram.
    expect(unitCostPerBase(320, 'bag_50kg')).toBe(640);
    expect(unitCostPerBase(320, 'bag_25kg')).toBe(1280);
  });

  it('leaves a base unit alone', () => {
    expect(unitCostPerBase(6.4, 'kg')).toBe(640);
    expect(unitCostPerBase(12, 'piece')).toBe(1200);
  });

  it('handles a crate of thirty eggs', () => {
    // GHS 45 a crate -> 150 pesewas an egg.
    expect(unitCostPerBase(45, 'crate')).toBe(150);
  });

  it('handles a thousand-dose vial', () => {
    expect(unitCostPerBase(90, 'vial_1000')).toBe(9);
  });

  it('refuses a negative price rather than storing a negative cost', () => {
    expect(() => unitCostPerBase(-5, 'kg')).toThrow(ReceivingError);
  });
});

describe('the invoice line and its rounding', () => {
  it('states what the delivery note should say', () => {
    // 4 bags at GHS 320 = GHS 1,280 = 128,000 pesewas.
    expect(lineTotal(4, 320)).toBe(128_000);
  });

  it('reports no drift when the price divides cleanly', () => {
    expect(roundingDrift(4, 320, 'bag_50kg')).toBe(0);
  });

  it('reports nothing when the price is already per base unit', () => {
    expect(roundingDrift(3, 100, 'piece')).toBe(0);
  });

  it('reports the drift when the pack size does not divide cleanly', () => {
    // GHS 100 a dozen is 833.33 pesewas an egg, stored as 833. Twelve of those
    // is 9,996 against an invoice line of 10,000 — four pesewas short, and said
    // out loud rather than absorbed.
    expect(roundingDrift(1, 100, 'dozen')).toBe(-4);
  });
});

describe('blending the cost of a batch received twice', () => {
  it('weights by quantity, not by delivery', () => {
    // 100 kg already on hand at 600, another 300 kg at 700 -> 675.
    expect(
      blendBatchCost({ onHandBase: 100, unitCostPesewas: 600 }, { quantityBase: 300, unitCostPesewas: 700 }),
    ).toBe(675);
  });

  it('takes the incoming cost when the batch is new', () => {
    expect(blendBatchCost(null, { quantityBase: 50, unitCostPesewas: 700 })).toBe(700);
  });

  it('takes the incoming cost when the batch never had one', () => {
    expect(
      blendBatchCost({ onHandBase: 100, unitCostPesewas: null }, { quantityBase: 50, unitCostPesewas: 700 }),
    ).toBe(700);
  });

  it('KEEPS the known cost when the new delivery has no price', () => {
    // Otherwise an invoice that has not arrived would wipe out a cost that had.
    expect(
      blendBatchCost({ onHandBase: 100, unitCostPesewas: 600 }, { quantityBase: 50, unitCostPesewas: null }),
    ).toBe(600);
  });

  it('ignores a negative prior balance rather than inverting the average', () => {
    expect(
      blendBatchCost({ onHandBase: -20, unitCostPesewas: 600 }, { quantityBase: 100, unitCostPesewas: 900 }),
    ).toBe(900);
  });
});

describe('deciding what a batch number means', () => {
  it('creates a batch that does not exist', () => {
    expect(decideBatch(null, d('2027-01-01'))).toEqual({ action: 'create' });
  });

  it('appends to a batch with the same date', () => {
    expect(
      decideBatch({ batchNumber: 'A1', expiresOn: d('2027-01-01') }, d('2027-01-01')),
    ).toEqual({ action: 'append' });
  });

  it('REFUSES the same batch number with a different expiry', () => {
    // Two dates under one number is two lots. Merging them would give the older
    // stock the newer date and FEFO would hold back what is about to expire.
    const r = decideBatch({ batchNumber: 'A1', expiresOn: d('2027-01-01') }, d('2027-06-01'));
    expect(r.action).toBe('refuse');
    if (r.action === 'refuse') {
      expect(r.reason).toMatch(/2027-01-01/);
      expect(r.reason).toMatch(/2027-06-01/);
    }
  });

  it('fills in an expiry the first receipt never recorded', () => {
    expect(decideBatch({ batchNumber: 'A1', expiresOn: null }, d('2027-01-01'))).toEqual({
      action: 'append-and-date',
      expiresOn: d('2027-01-01'),
    });
  });

  it('keeps the recorded expiry when this delivery gives none', () => {
    expect(decideBatch({ batchNumber: 'A1', expiresOn: d('2027-01-01') }, null)).toEqual({
      action: 'append',
    });
  });
});

describe('stamping a batch number for a delivery that arrived without one', () => {
  it('uses the item code and the date', () => {
    expect(suggestBatchNumber('FD-LAYER-MASH', d('2026-08-26'))).toBe('FD-LAYER-MASH-20260826');
  });

  it('separates a second delivery on the same day', () => {
    expect(suggestBatchNumber('FD-LAYER-MASH', d('2026-08-26'), 1)).toBe(
      'FD-LAYER-MASH-20260826-2',
    );
  });
});

describe('receipt plausibility — warn, never block', () => {
  const base = {
    quantityEntered: 4,
    priceCedis: 320,
    unitKey: 'bag_50kg',
    expiresOn: null as Date | null,
    occurredOn: d('2026-08-26'),
    isPerishable: false,
    previousUnitCostPesewas: null as number | null,
  };

  it('says nothing about an ordinary delivery', () => {
    expect(checkReceipt(base)).toEqual([]);
  });

  it('notices an expiring item received with no expiry date', () => {
    const w = checkReceipt({ ...base, isPerishable: true });
    expect(w.map((x) => x.field)).toContain('expiresOn');
  });

  it('notices stock that expired before it arrived', () => {
    const w = checkReceipt({ ...base, expiresOn: d('2026-08-01') });
    expect(w[0].message).toMatch(/expired 25 day\(s\) before it arrived/);
  });

  it('notices stock with barely any life left', () => {
    const w = checkReceipt({ ...base, expiresOn: d('2026-09-10') });
    expect(w[0].message).toMatch(/expires in 15 day\(s\)/);
  });

  it('says nothing about a comfortable expiry', () => {
    expect(checkReceipt({ ...base, expiresOn: d('2027-08-01') })).toEqual([]);
  });

  it('notices a missing price, because it silently breaks flock costing', () => {
    const w = checkReceipt({ ...base, priceCedis: null });
    expect(w[0].message).toMatch(/missing from the flock costing/);
  });

  it('notices a price that has moved sharply', () => {
    // Holding feed at 640 pesewas/kg, this delivery is 900 — a 41% jump.
    const w = checkReceipt({ ...base, priceCedis: 450, previousUnitCostPesewas: 640 });
    expect(w[0].message).toMatch(/41% higher/);
  });

  it('says nothing about ordinary price movement', () => {
    const w = checkReceipt({ ...base, priceCedis: 340, previousUnitCostPesewas: 640 });
    expect(w).toEqual([]);
  });

  it('never compares against a price that does not exist', () => {
    expect(checkReceipt({ ...base, previousUnitCostPesewas: null })).toEqual([]);
    expect(checkReceipt({ ...base, previousUnitCostPesewas: 0 })).toEqual([]);
  });

  it('flags a wrong-unit invoice, which is the usual cause of a 50x price', () => {
    // GHS 320 typed as a per-KILOGRAM price rather than per bag.
    const w = checkReceipt({ ...base, unitKey: 'kg', previousUnitCostPesewas: 640 });
    expect(w[0].message).toMatch(/higher/);
    expect(w[0].message).toMatch(/Check the unit on the invoice/);
  });
});

describe('acknowledging the warnings that were actually shown', () => {
  it('is stable regardless of the order they were produced in', () => {
    const a = [
      { field: 'priceCedis', message: 'one' },
      { field: 'expiresOn', message: 'two' },
    ];
    expect(warningToken(a)).toBe(warningToken([...a].reverse()));
  });

  it('CHANGES when a different problem appears', () => {
    // The bug this prevents: fix the price, mistype the quantity, and the old
    // acknowledgement saves a warning nobody ever saw.
    const before = warningToken([{ field: 'priceCedis', message: 'price looks high' }]);
    const after = warningToken([{ field: 'expiresOn', message: 'expires in 3 days' }]);
    expect(after).not.toBe(before);
  });
});

describe('receipt form validation', () => {
  const form = (over: Record<string, string> = {}) => ({
    itemId: 'item-1',
    stockLocationId: 'store-1',
    quantity: '4',
    enteredUomKey: 'bag_50kg',
    occurredOn: '2026-08-20',
    ...over,
  });

  it('accepts a plain delivery', () => {
    const r = receiptSchema.safeParse(form());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.priceCedis).toBeNull();
      expect(r.data.batchNumber).toBeNull();
      expect(r.data.expiresOn).toBeNull();
    }
  });

  it('refuses a delivery dated in the future', () => {
    const r = receiptSchema.safeParse(form({ occurredOn: '2099-01-01' }));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/future/);
  });

  it('ALLOWS an expiry in the past, because expired stock does get delivered', () => {
    const r = receiptSchema.safeParse(form({ expiresOn: '2020-01-01' }));
    expect(r.success).toBe(true);
  });

  it('refuses a receipt of nothing', () => {
    expect(receiptSchema.safeParse(form({ quantity: '0' })).success).toBe(false);
    expect(receiptSchema.safeParse(form({ quantity: '' })).success).toBe(false);
  });

  it('BLANK IS NOT ZERO for a price', () => {
    const blank = receiptSchema.safeParse(form({ priceCedis: '' }));
    expect(blank.success && blank.data.priceCedis).toBeNull();

    const free = receiptSchema.safeParse(form({ priceCedis: '0' }));
    expect(free.success && free.data.priceCedis).toBe(0);
  });
});
