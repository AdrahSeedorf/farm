import { describe, it, expect } from 'vitest';
import {
  linesAreEditable,
  whyLinesAreLocked,
  lineTotal,
  orderTotal,
  orderBaseUnits,
  orderNumberFor,
  sequenceOf,
  withdrawalGate,
  lineErrors,
  confirmErrors,
  cancelErrors,
  sortOrders,
  orderSummary,
  orderCountSentence,
  committedSentence,
  STATE_LABELS,
  type SalesOrder,
  type OrderLine,
} from '@/lib/sales';
import { fromCedis, pesewas } from '@/lib/money';

const DAY = 86_400_000;
const NOW = new Date('2026-09-11T00:00:00.000Z');

function line(over: Partial<OrderLine> = {}): OrderLine {
  return {
    id: over.id ?? 'l1',
    productId: over.productId ?? 'p1',
    productName: over.productName ?? 'Crate of 30 — Large',
    packLabel: over.packLabel ?? 'crate',
    unitsPerPack: over.unitsPerPack ?? 30,
    quantity: over.quantity ?? 3,
    unitPricePesewas: over.unitPricePesewas ?? fromCedis(45),
    priceBasis: over.priceBasis ?? 'LIST',
    note: over.note ?? null,
  };
}

function order(over: Partial<SalesOrder> = {}): SalesOrder {
  const lines = over.lines ?? [line()];
  return {
    id: over.id ?? 'o1',
    orderNumber: over.orderNumber ?? 'SO-2026-0001',
    state: over.state ?? 'DRAFT',
    customerId: over.customerId ?? 'c1',
    customerName: over.customerName ?? 'Serwaa Cold Store',
    customerPhone: over.customerPhone ?? '+233209998887',
    siteId: over.siteId ?? 's1',
    siteName: over.siteName ?? 'Main farm',
    orderedOn: over.orderedOn ?? NOW,
    wantedOn: over.wantedOn ?? null,
    drawnFromFlockId: over.drawnFromFlockId ?? null,
    drawnFromFlockName: over.drawnFromFlockName ?? null,
    notes: over.notes ?? null,
    lines,
    totalPesewas: orderTotal(lines),
    createdByName: over.createdByName ?? null,
    confirmedAt: over.confirmedAt ?? null,
    confirmedByName: over.confirmedByName ?? null,
    cancelledAt: over.cancelledAt ?? null,
    cancelledByName: over.cancelledByName ?? null,
    cancelReason: over.cancelReason ?? null,
  };
}

describe('what may still be changed', () => {
  // ONCE IT IS CONFIRMED IT IS A PROMISE. Editing it quietly means the farm and
  // the shop are holding two different orders.
  it('LOCKS A CONFIRMED ORDER, and says why', () => {
    expect(linesAreEditable('DRAFT')).toBe(true);
    expect(linesAreEditable('CONFIRMED')).toBe(false);
    expect(whyLinesAreLocked('CONFIRMED')).toMatch(/two different orders/);
    expect(whyLinesAreLocked('DRAFT')).toBeNull();
  });
});

describe('totals', () => {
  it('multiplies in integer pesewas', () => {
    expect(lineTotal({ quantity: 3, unitPricePesewas: fromCedis(45) })).toBe(fromCedis(135));
  });

  it('adds lines without float drift', () => {
    const total = orderTotal([
      { quantity: 3, unitPricePesewas: fromCedis(45.5) },
      { quantity: 2, unitPricePesewas: fromCedis(40.25) },
    ]);
    expect(total).toBe(fromCedis(217));
  });

  it('totals an empty order to zero rather than throwing', () => {
    expect(orderTotal([])).toBe(pesewas(0));
  });

  // Crates are what the buyer ordered; eggs are what leaves the store.
  it('SAYS THE QUANTITY IN THE THING ITSELF TOO', () => {
    expect(
      orderBaseUnits([
        { quantity: 3, unitsPerPack: 30 },
        { quantity: 2, unitsPerPack: 12 },
      ]),
    ).toBe(114);
  });
});

describe('order numbers', () => {
  it('reads aloud down a phone', () => {
    expect(orderNumberFor(2026, 7)).toBe('SO-2026-0007');
  });

  it('round-trips', () => {
    expect(sequenceOf('SO-2026-0007', 2026)).toBe(7);
  });

  it('ignores another year and anything malformed', () => {
    expect(sequenceOf('SO-2025-0007', 2026)).toBe(0);
    expect(sequenceOf('', 2026)).toBe(0);
    expect(sequenceOf('PO-2026-0007', 2026)).toBe(0);
  });
});

describe('the withdrawal gate', () => {
  const restricted = [
    { flockId: 'f1', name: 'House A', clearsOn: new Date('2026-09-20T00:00:00.000Z') },
  ];

  it('asks nothing while nothing is restricted', () => {
    expect(
      withdrawalGate({ restricted: [], drawnFromFlockId: null, hasProduceLines: true }),
    ).toEqual({ kind: 'CLEAR' });
  });

  it('asks nothing about an order with nothing on it', () => {
    expect(
      withdrawalGate({ restricted, drawnFromFlockId: null, hasProduceLines: false }),
    ).toEqual({ kind: 'CLEAR' });
  });

  // THE HONEST VERSION OF THE PROMISE THE FARM MAKES PUBLICLY. Eggs are pooled,
  // so the software will not guess which house a crate came from.
  it('WILL NOT GUESS — it demands a house while anything is restricted', () => {
    const verdict = withdrawalGate({
      restricted,
      drawnFromFlockId: null,
      hasProduceLines: true,
    });
    expect(verdict.kind).toBe('NEEDS_SOURCE');
    if (verdict.kind === 'NEEDS_SOURCE') {
      expect(verdict.message).toContain('House A');
      expect(verdict.message).toMatch(/will not guess/);
    }
  });

  it('REFUSES OUTRIGHT when the produce comes from the restricted house', () => {
    const verdict = withdrawalGate({
      restricted,
      drawnFromFlockId: 'f1',
      hasProduceLines: true,
    });
    expect(verdict.kind).toBe('REFUSED');
    if (verdict.kind === 'REFUSED') {
      expect(verdict.message).toContain('House A');
      // The date it clears, so the message says when rather than only no.
      expect(verdict.message).toContain('2026-09-20');
    }
  });

  it('lets an order from a clear house through', () => {
    expect(
      withdrawalGate({ restricted, drawnFromFlockId: 'f2', hasProduceLines: true }),
    ).toEqual({ kind: 'CLEAR' });
  });

  it('names every restricted house, not just the first', () => {
    const verdict = withdrawalGate({
      restricted: [
        ...restricted,
        { flockId: 'f2', name: 'House B', clearsOn: new Date('2026-09-25') },
      ],
      drawnFromFlockId: null,
      hasProduceLines: true,
    });
    if (verdict.kind === 'NEEDS_SOURCE') {
      expect(verdict.message).toContain('House A');
      expect(verdict.message).toContain('House B');
    } else {
      throw new Error('expected NEEDS_SOURCE');
    }
  });
});

describe('validation', () => {
  it('needs a quantity above zero', () => {
    expect(lineErrors({ quantity: 0, unitPricePesewas: fromCedis(45) })[0]).toMatch(/above zero/);
  });

  // HALF A CRATE IS A TRAY, and a tray is its own product.
  it('REFUSES A PART PACK, and says what to do instead', () => {
    expect(lineErrors({ quantity: 1.5, unitPricePesewas: fromCedis(45) })[0]).toMatch(
      /sell them trays/,
    );
  });

  it('refuses an order for a product with no price', () => {
    expect(lineErrors({ quantity: 3, unitPricePesewas: null })[0]).toMatch(/no price/);
  });

  it('catches an order that is plainly a typo', () => {
    expect(lineErrors({ quantity: 500_000, unitPricePesewas: fromCedis(45) })[0]).toMatch(
      /very large order/,
    );
  });

  it('will not confirm an empty order', () => {
    expect(confirmErrors({ state: 'DRAFT', lines: [] })[0]).toMatch(/nothing on this order/i);
  });

  it('will not confirm anything but a draft', () => {
    expect(confirmErrors({ state: 'CONFIRMED', lines: [line()] })[0]).toMatch(/only a draft/i);
  });

  it('needs a reason to cancel', () => {
    expect(cancelErrors({ state: 'DRAFT', reason: '' })[0]).toMatch(/say why/i);
    expect(cancelErrors({ state: 'DRAFT', reason: 'Buyer changed their mind' })).toEqual([]);
  });

  it('will not cancel twice', () => {
    expect(cancelErrors({ state: 'CANCELLED', reason: 'x y z' })[0]).toMatch(/already cancelled/);
  });
});

describe('the list', () => {
  // A DRAFT IS UNFINISHED WORK, and the buyer thinks it was placed.
  it('PUTS DRAFTS AT THE TOP', () => {
    const draft = order({ id: 'draft', state: 'DRAFT' });
    const confirmed = order({ id: 'confirmed', state: 'CONFIRMED' });
    const cancelled = order({ id: 'cancelled', state: 'CANCELLED' });
    expect(sortOrders([cancelled, confirmed, draft]).map((o) => o.id)).toEqual([
      'draft',
      'confirmed',
      'cancelled',
    ]);
  });

  it('sorts confirmed orders by when the buyer wants them', () => {
    const soon = order({ id: 'soon', state: 'CONFIRMED', wantedOn: new Date(NOW.getTime() + DAY) });
    const later = order({
      id: 'later',
      state: 'CONFIRMED',
      wantedOn: new Date(NOW.getTime() + 5 * DAY),
    });
    expect(sortOrders([later, soon]).map((o) => o.id)).toEqual(['soon', 'later']);
  });

  it('summarises what is outstanding', () => {
    const summary = orderSummary([
      order({ id: 'a', state: 'DRAFT' }),
      order({ id: 'b', state: 'CONFIRMED' }),
    ]);
    expect(summary).toContain('1 still being written');
    expect(summary).toContain('GHS 135.00');
  });

  it('says so plainly when there is nothing', () => {
    expect(orderSummary([])).toBe('No orders yet.');
  });

  /**
   * A driver holds `order:view` and not `price:view`. The summary they get has
   * to answer "how much is waiting?" without answering "what is it worth?".
   */
  it('COUNTS WITHOUT PRICING, for a reader who may not see money', () => {
    const sentence = orderCountSentence([
      order({ id: 'a', state: 'DRAFT' }),
      order({ id: 'b', state: 'CONFIRMED' }),
      order({ id: 'c', state: 'CONFIRMED' }),
    ]);
    expect(sentence).toContain('1 still being written');
    expect(sentence).toContain('2 confirmed orders');
    expect(sentence).not.toMatch(/GHS/);
  });

  it('says the same nothing when there are no orders', () => {
    expect(orderCountSentence([])).toBe('No orders yet.');
  });
});

describe('what a buyer has been committed to', () => {
  // DELIBERATELY NOT CALLED A BALANCE. A balance is what is owed, and payments
  // are not recorded anywhere yet.
  it('IS NOT CALLED A BALANCE, AND SAYS WHY', () => {
    const sentence = committedSentence([order({ state: 'CONFIRMED' })]);
    expect(sentence).toContain('GHS 135.00');
    expect(sentence).toMatch(/not what is owed/);
    expect(sentence).toMatch(/payments are not recorded yet/i);
    expect(sentence.toLowerCase()).not.toContain('balance');
  });

  it('counts only confirmed orders', () => {
    expect(committedSentence([order({ state: 'DRAFT' })])).toBe('Nothing confirmed.');
  });

  it('labels every state in words a farmer would use', () => {
    expect(STATE_LABELS.DRAFT).toMatch(/written/);
    expect(STATE_LABELS.CONFIRMED).toMatch(/buyer/);
  });
});
