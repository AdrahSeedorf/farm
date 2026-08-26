import { describe, it, expect } from 'vitest';
import {
  stockDeltaFor,
  quantityOnHand,
  quantityByBatch,
  selectBatchesFEFO,
  expiredBatches,
  expiringSoon,
  weightedUnitCost,
  daysOfCover,
  assertStockCoherent,
  stockStatus,
  StockError,
  type StockMovementRecord,
  type BatchStock,
} from '../stock-ledger';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const move = (
  type: Parameters<typeof stockDeltaFor>[0],
  quantity: number,
  on: string,
  itemBatchId?: string,
): StockMovementRecord => ({
  type,
  deltaBase: stockDeltaFor(type, quantity),
  occurredOn: d(on),
  itemBatchId,
});

describe('stockDeltaFor — the only place a stock sign is decided', () => {
  it('adds for receipts, returns and transfers in', () => {
    expect(stockDeltaFor('PURCHASE_RECEIPT', 500)).toBe(500);
    expect(stockDeltaFor('RETURN', 25)).toBe(25);
    expect(stockDeltaFor('TRANSFER_IN', 100)).toBe(100);
  });

  it('subtracts for issues, damage, expiry and sales', () => {
    expect(stockDeltaFor('ISSUE', 200)).toBe(-200);
    expect(stockDeltaFor('DAMAGE', 5)).toBe(-5);
    expect(stockDeltaFor('EXPIRY', 10)).toBe(-10);
    expect(stockDeltaFor('SALE', 30)).toBe(-30);
  });

  it('refuses a negative quantity — the movement type carries the direction', () => {
    expect(() => stockDeltaFor('ISSUE', -200)).toThrow(/positive quantity/);
    expect(() => stockDeltaFor('PURCHASE_RECEIPT', 0)).toThrow(/positive quantity/);
  });

  it('accepts a signed value only for an adjustment', () => {
    expect(stockDeltaFor('ADJUSTMENT', -12)).toBe(-12);
    expect(stockDeltaFor('ADJUSTMENT', 12)).toBe(12);
    expect(() => stockDeltaFor('ADJUSTMENT', 0)).toThrow(/records nothing/);
  });

  it('handles fractional quantities, since feed is weighed', () => {
    expect(stockDeltaFor('ISSUE', 12.5)).toBe(-12.5);
  });
});

describe('quantity on hand is derived, never stored', () => {
  const feed: StockMovementRecord[] = [
    move('PURCHASE_RECEIPT', 1000, '2026-03-01'),
    move('ISSUE', 200, '2026-03-02'),
    move('ISSUE', 210, '2026-03-03'),
    move('DAMAGE', 25, '2026-03-04'),
    move('PURCHASE_RECEIPT', 500, '2026-03-05'),
  ];

  it('sums the ledger', () => {
    expect(quantityOnHand(feed)).toBe(1065);
  });

  it('answers what was on hand on a past date', () => {
    expect(quantityOnHand(feed, d('2026-03-01'))).toBe(1000);
    expect(quantityOnHand(feed, d('2026-03-03'))).toBe(590);
  });

  it('is unaffected by the order rows were written in', () => {
    expect(quantityOnHand([...feed].reverse())).toBe(quantityOnHand(feed));
  });

  it('splits stock by batch', () => {
    const byBatch = quantityByBatch([
      move('PURCHASE_RECEIPT', 500, '2026-03-01', 'b1'),
      move('PURCHASE_RECEIPT', 500, '2026-03-02', 'b2'),
      move('ISSUE', 120, '2026-03-03', 'b1'),
    ]);
    expect(byBatch.get('b1')).toBe(380);
    expect(byBatch.get('b2')).toBe(500);
  });
});

describe('first expiry, first out', () => {
  // Received later but expiring sooner — FIFO would issue the wrong one and
  // guarantee the shorter-dated batch is thrown away.
  const batches: BatchStock[] = [
    { id: 'old', batchNumber: 'A', expiresOn: d('2026-12-01'), onHand: 40 },
    { id: 'new', batchNumber: 'B', expiresOn: d('2026-09-01'), onHand: 30 },
    { id: 'undated', batchNumber: 'C', expiresOn: null, onHand: 100 },
  ];

  it('draws from the soonest to expire first', () => {
    const { allocations, shortfall } = selectBatchesFEFO(batches, 20);
    expect(allocations).toEqual([
      { batchId: 'new', batchNumber: 'B', quantity: 20, expiresOn: d('2026-09-01') },
    ]);
    expect(shortfall).toBe(0);
  });

  it('spills into the next batch when the first runs out', () => {
    const { allocations } = selectBatchesFEFO(batches, 50);
    expect(allocations.map((a) => [a.batchId, a.quantity])).toEqual([
      ['new', 30],
      ['old', 20],
    ]);
  });

  it('leaves undated stock until last, since it can wait', () => {
    const { allocations } = selectBatchesFEFO(batches, 100);
    expect(allocations.map((a) => a.batchId)).toEqual(['new', 'old', 'undated']);
  });

  it('reports a shortfall rather than throwing', () => {
    const { allocations, shortfall } = selectBatchesFEFO(batches, 500);
    expect(allocations).toHaveLength(3);
    expect(shortfall).toBe(330);
  });

  it('ignores empty batches', () => {
    const { allocations } = selectBatchesFEFO(
      [{ id: 'x', batchNumber: 'X', expiresOn: d('2026-01-01'), onHand: 0 }, ...batches],
      10,
    );
    expect(allocations[0].batchId).toBe('new');
  });

  it('asks for nothing when nothing is needed', () => {
    expect(selectBatchesFEFO(batches, 0).allocations).toEqual([]);
  });
});

describe('expiry', () => {
  const today = d('2026-08-21');
  const batches: BatchStock[] = [
    { id: 'gone', batchNumber: 'A', expiresOn: d('2026-08-01'), onHand: 5 },
    { id: 'soon', batchNumber: 'B', expiresOn: d('2026-09-10'), onHand: 8 },
    { id: 'later', batchNumber: 'C', expiresOn: d('2027-01-01'), onHand: 12 },
    { id: 'empty', batchNumber: 'D', expiresOn: d('2026-08-02'), onHand: 0 },
    { id: 'feed', batchNumber: 'E', expiresOn: null, onHand: 900 },
  ];

  it('finds stock already past its date', () => {
    expect(expiredBatches(batches, today).map((b) => b.id)).toEqual(['gone']);
  });

  it('ignores expired batches with nothing left', () => {
    expect(expiredBatches(batches, today).map((b) => b.id)).not.toContain('empty');
  });

  it('finds what is about to expire, soonest first', () => {
    expect(expiringSoon(batches, today, 30).map((b) => b.id)).toEqual(['soon']);
    expect(expiringSoon(batches, today, 200).map((b) => b.id)).toEqual(['soon', 'later']);
  });

  it('never treats undated stock as expiring', () => {
    expect(expiringSoon(batches, today, 3650).map((b) => b.id)).not.toContain('feed');
    expect(expiredBatches(batches, today).map((b) => b.id)).not.toContain('feed');
  });
});

describe('cost of what is on hand', () => {
  it('weights by remaining quantity, because March feed is not July feed', () => {
    // 100 kg at 250 pesewas + 300 kg at 290 pesewas
    const cost = weightedUnitCost([
      { id: 'a', batchNumber: 'A', expiresOn: null, onHand: 100, unitCostPesewas: 250 },
      { id: 'b', batchNumber: 'B', expiresOn: null, onHand: 300, unitCostPesewas: 290 },
    ]);
    expect(cost).toBe(280);
  });

  it('ignores batches with nothing left', () => {
    const cost = weightedUnitCost([
      { id: 'a', batchNumber: 'A', expiresOn: null, onHand: 0, unitCostPesewas: 100 },
      { id: 'b', batchNumber: 'B', expiresOn: null, onHand: 50, unitCostPesewas: 300 },
    ]);
    expect(cost).toBe(300);
  });

  it('returns null rather than a zero that would make feed look free', () => {
    expect(weightedUnitCost([])).toBeNull();
    expect(
      weightedUnitCost([{ id: 'a', batchNumber: 'A', expiresOn: null, onHand: 50 }]),
    ).toBeNull();
  });
});

describe('days of cover', () => {
  it('converts stock into a date you run out', () => {
    expect(daysOfCover(1750, 214)).toBeCloseTo(8.18, 2);
  });

  it('returns null when nothing is being used — not Infinity', () => {
    expect(daysOfCover(1000, 0)).toBeNull();
    expect(daysOfCover(1000, -5)).toBeNull();
  });
});

describe('ledger coherence', () => {
  it('accepts a well-formed ledger', () => {
    expect(() =>
      assertStockCoherent([move('PURCHASE_RECEIPT', 100, '2026-03-01'), move('ISSUE', 40, '2026-03-02')]),
    ).not.toThrow();
  });

  it('shouts when more stock leaves than ever arrived', () => {
    expect(() =>
      assertStockCoherent(
        [move('PURCHASE_RECEIPT', 10, '2026-03-01'), move('ISSUE', 40, '2026-03-02')],
        'Layer mash',
      ),
    ).toThrow(StockError);
  });

  it('names the item so the message is actionable', () => {
    expect(() =>
      assertStockCoherent([move('ISSUE', 5, '2026-03-02')], 'Newcastle vaccine'),
    ).toThrow(/Newcastle vaccine/);
  });

  it('does not trip on floating point dust', () => {
    expect(() =>
      assertStockCoherent([
        move('PURCHASE_RECEIPT', 0.1, '2026-03-01'),
        move('PURCHASE_RECEIPT', 0.2, '2026-03-01'),
        move('ISSUE', 0.3, '2026-03-02'),
      ]),
    ).not.toThrow();
  });
});

describe('stock status against thresholds', () => {
  it('reports empty before anything else', () => {
    expect(stockStatus(0, 200, 100)).toBe('OUT');
    expect(stockStatus(-5, 200, 100)).toBe('OUT');
  });

  it('treats the minimum as the harder floor', () => {
    expect(stockStatus(80, 200, 100)).toBe('CRITICAL');
    expect(stockStatus(150, 200, 100)).toBe('LOW');
    expect(stockStatus(500, 200, 100)).toBe('OK');
  });

  it('checks the minimum first even when the farm sets them the wrong way round', () => {
    // Minimum above reorder is a data-entry mistake, but the urgent one must
    // still win — silently reporting "reorder" on critically low feed is worse
    // than reporting the farm's own inconsistency back to them.
    expect(stockStatus(120, 100, 200)).toBe('CRITICAL');
  });

  it('fires AT the threshold, not below it', () => {
    expect(stockStatus(200, 200, null)).toBe('LOW');
    expect(stockStatus(201, 200, null)).toBe('OK');
  });

  it('distinguishes "fine" from "nobody said what fine means"', () => {
    expect(stockStatus(500, null, null)).toBe('UNTRACKED');
    expect(stockStatus(500, 200, null)).toBe('OK');
  });

  it('honours a threshold of zero as a real setting', () => {
    // Alert only on stockout is a legitimate choice for an item that is ordered
    // to demand — it must not be read as "no threshold set".
    expect(stockStatus(1, 0, null)).toBe('OK');
    expect(stockStatus(0, 0, null)).toBe('OUT');
  });
});
