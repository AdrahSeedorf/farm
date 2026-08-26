import { describe, it, expect } from 'vitest';
import { costOfAllocations, checkFeedIssue, uncostedNote } from '../feed-issue';
import { selectBatchesFEFO, type BatchStock } from '../stock-ledger';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('costing what was actually issued', () => {
  it('charges each batch at its own price, not at an average', () => {
    // 30 kg from a batch bought at 600, 20 kg from one bought at 700.
    const cost = costOfAllocations(
      [
        { batchId: 'a', batchNumber: 'A', quantity: 30, expiresOn: null },
        { batchId: 'b', batchNumber: 'B', quantity: 20, expiresOn: null },
      ],
      new Map([
        ['a', 600],
        ['b', 700],
      ]),
    );
    expect(cost.pesewas).toBe(32_000); // GHS 320.00
    expect(cost.uncostedBase).toBe(0);
  });

  it('is NOT the same answer an item-wide average would give', () => {
    // The average of 600 and 700 is 650; 50 kg at 650 would be 32,500.
    // The real answer is 32,000, because FEFO drew more from the cheaper batch.
    const allocations = [
      { batchId: 'a', batchNumber: 'A', quantity: 30, expiresOn: null },
      { batchId: 'b', batchNumber: 'B', quantity: 20, expiresOn: null },
    ];
    const real = costOfAllocations(allocations, new Map([['a', 600], ['b', 700]])).pesewas;
    expect(real).not.toBe(Math.round(50 * 650));
  });

  it('counts feed from an unpriced batch as unpriced, not as free', () => {
    const cost = costOfAllocations(
      [
        { batchId: 'a', batchNumber: 'A', quantity: 30, expiresOn: null },
        { batchId: 'b', batchNumber: 'B', quantity: 20, expiresOn: null },
      ],
      new Map<string, number | null>([
        ['a', 600],
        ['b', null],
      ]),
    );
    expect(cost.pesewas).toBe(18_000);
    expect(cost.uncostedBase).toBe(20);
  });

  it('treats a batch missing from the map the same as one with no price', () => {
    const cost = costOfAllocations(
      [{ batchId: 'ghost', batchNumber: 'G', quantity: 10, expiresOn: null }],
      new Map(),
    );
    expect(cost.pesewas).toBe(0);
    expect(cost.uncostedBase).toBe(10);
  });

  it('costs nothing when nothing was issued', () => {
    expect(costOfAllocations([], new Map())).toEqual({ pesewas: 0, uncostedBase: 0 });
  });
});

describe('FEFO and costing together', () => {
  // The point of the two working together: the cheaper batch is not chosen
  // because it is cheaper, it is chosen because it expires first — and the cost
  // then follows the birds rather than the accountant.
  const batches: BatchStock[] = [
    { id: 'old', batchNumber: 'A', expiresOn: d('2026-09-01'), onHand: 30, unitCostPesewas: 600 },
    { id: 'new', batchNumber: 'B', expiresOn: d('2026-12-01'), onHand: 500, unitCostPesewas: 700 },
  ];

  it('empties the shortest-dated batch before touching the other', () => {
    const { allocations, shortfall } = selectBatchesFEFO(batches, 50);
    expect(allocations.map((a) => [a.batchId, a.quantity])).toEqual([
      ['old', 30],
      ['new', 20],
    ]);
    expect(shortfall).toBe(0);

    const cost = costOfAllocations(
      allocations,
      new Map(batches.map((b) => [b.id, b.unitCostPesewas ?? null])),
    );
    expect(cost.pesewas).toBe(32_000);
  });

  it('reports a shortfall rather than issuing feed that is not there', () => {
    const { allocations, shortfall } = selectBatchesFEFO(batches, 1000);
    expect(shortfall).toBe(470);
    expect(allocations.reduce((s, a) => s + a.quantity, 0)).toBe(530);
  });
});

describe('what to say when the store disagrees with the house', () => {
  const base = {
    requestedBase: 50,
    availableBase: 500,
    itemName: 'Layer mash',
    storeName: 'Farm Store',
  };

  it('says nothing about an ordinary morning', () => {
    expect(checkFeedIssue(base)).toEqual([]);
  });

  it('names the shortfall and says the record still saves', () => {
    const w = checkFeedIssue({ ...base, availableBase: 12 });
    expect(w).toHaveLength(1);
    expect(w[0].message).toMatch(/only 12 kg of Layer mash in Farm Store/);
    expect(w[0].message).toMatch(/50 kg was fed/);
    expect(w[0].message).toMatch(/saved in full/);
    expect(w[0].message).toMatch(/delivery has probably not been entered/);
  });

  it('mentions when this empties the store, which is worth knowing at 6am', () => {
    const w = checkFeedIssue({ ...base, availableBase: 50 });
    expect(w[0].message).toMatch(/down to nothing/);
  });

  it('does not warn twice about the same thing', () => {
    expect(checkFeedIssue({ ...base, availableBase: 12 })).toHaveLength(1);
  });

  it('warns about a store that is already empty', () => {
    const w = checkFeedIssue({ ...base, availableBase: 0 });
    expect(w[0].message).toMatch(/only 0 kg/);
  });
});

describe('reporting feed that carried no price', () => {
  it('says how far short the flock cost is', () => {
    expect(uncostedNote(20, 'Layer mash')).toMatch(/20 kg of Layer mash[\s\S]*understated/);
  });

  it('says nothing when everything was priced', () => {
    expect(uncostedNote(0, 'Layer mash')).toBeNull();
  });
});
