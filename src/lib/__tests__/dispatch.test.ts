import { describe, it, expect } from 'vitest';
import {
  referenceFor,
  sequenceOf,
  isLive,
  baseUnitsOf,
  packsSentence,
  dispatchedByLine,
  progressOf,
  fulfilmentOf,
  fulfilmentSentence,
  whyNotDispatchable,
  canDispatch,
  dispatchErrors,
  dispatchWarnings,
  reversalErrors,
  reversalSentence,
  sortDispatches,
  dispatchSummary,
  METHOD_LABELS,
  type Dispatch,
  type DispatchLine,
} from '@/lib/dispatch';
import type { OrderLine } from '@/lib/sales';
import { fromCedis } from '@/lib/money';

const DAY = 86_400_000;
const TODAY = new Date('2026-09-11T00:00:00.000Z');

function orderLine(over: Partial<OrderLine> = {}): OrderLine {
  return {
    id: over.id ?? 'ol1',
    productId: over.productId ?? 'p1',
    productName: over.productName ?? 'Crate of 30 — Large',
    packLabel: over.packLabel ?? 'crate',
    unitsPerPack: over.unitsPerPack ?? 30,
    quantity: over.quantity ?? 10,
    unitPricePesewas: over.unitPricePesewas ?? fromCedis(45),
    priceBasis: over.priceBasis ?? 'LIST',
    note: over.note ?? null,
  };
}

function dline(over: Partial<DispatchLine> = {}): DispatchLine {
  return {
    id: over.id ?? 'dl1',
    // `?? 'ol1'` would turn a deliberate null back into a line id, which is the
    // one case this helper exists to express: something added at the gate.
    salesOrderLineId:
      over.salesOrderLineId === undefined ? 'ol1' : over.salesOrderLineId,
    productId: over.productId ?? 'p1',
    productName: over.productName ?? 'Crate of 30 — Large',
    packLabel: over.packLabel ?? 'crate',
    unitsPerPack: over.unitsPerPack ?? 30,
    quantity: over.quantity ?? 6,
  };
}

function dispatch(over: Partial<Dispatch> = {}): Dispatch {
  return {
    id: over.id ?? 'd1',
    reference: over.reference ?? 'DSP-2026-0001',
    salesOrderId: over.salesOrderId ?? 'so1',
    orderNumber: over.orderNumber ?? 'SO-2026-0001',
    customerName: over.customerName ?? 'Serwaa Cold Store',
    method: over.method ?? 'COLLECTED',
    dispatchedOn: over.dispatchedOn ?? TODAY,
    takenBy: over.takenBy ?? null,
    vehicle: over.vehicle ?? null,
    receivedBy: over.receivedBy ?? null,
    notes: over.notes ?? null,
    lines: over.lines ?? [dline()],
    recordedByName: over.recordedByName ?? 'Owner',
    createdAt: over.createdAt ?? TODAY,
    reversedAt: over.reversedAt ?? null,
    reversedByName: over.reversedByName ?? null,
    reversalReason: over.reversalReason ?? null,
  };
}

describe('the reference on the paper that travels with the load', () => {
  it('reads aloud and sorts', () => {
    expect(referenceFor(2026, 7)).toBe('DSP-2026-0007');
    expect(referenceFor(2026, 1234)).toBe('DSP-2026-1234');
  });

  it('round-trips', () => {
    expect(sequenceOf(referenceFor(2026, 42), 2026)).toBe(42);
  });

  it('does not read another year’s number as this year’s', () => {
    expect(sequenceOf('DSP-2025-0042', 2026)).toBe(0);
  });
});

describe('what went out', () => {
  it('counts in the thing itself, not in packs', () => {
    // 6 crates of 30 is 180 eggs. The person picking counts crates; the person
    // checking production counts eggs.
    expect(baseUnitsOf([dline({ quantity: 6, unitsPerPack: 30 })])).toBe(180);
  });

  it('says the load in words a gateman would use', () => {
    expect(packsSentence([dline({ quantity: 1 })])).toBe('1 crate of Crate of 30 — Large');
    expect(packsSentence([dline({ quantity: 6 })])).toContain('6 crates');
  });

  it('labels both ways produce leaves the farm', () => {
    expect(METHOD_LABELS.COLLECTED).toMatch(/collected/i);
    expect(METHOD_LABELS.DELIVERED).toMatch(/deliver/i);
  });
});

describe('fulfilment is derived from the dispatch rows', () => {
  const lines = [orderLine({ id: 'ol1', quantity: 10 })];

  it('an order with no dispatches has had nothing go out', () => {
    const progress = progressOf(lines, []);
    expect(fulfilmentOf(progress)).toBe('NOTHING_SENT');
    expect(fulfilmentSentence(progress)).toBe('Nothing has gone out yet.');
  });

  it('PART DISPATCH IS ORDINARY, and says what is still to come', () => {
    const progress = progressOf(lines, [dispatch({ lines: [dline({ quantity: 6 })] })]);
    expect(fulfilmentOf(progress)).toBe('PART_SENT');
    expect(progress[0].outstanding).toBe(4);
    expect(fulfilmentSentence(progress)).toContain('4 crates');
  });

  it('adds up across several loads', () => {
    const progress = progressOf(lines, [
      dispatch({ id: 'd1', lines: [dline({ id: 'a', quantity: 6 })] }),
      dispatch({ id: 'd2', lines: [dline({ id: 'b', quantity: 4 })] }),
    ]);
    expect(fulfilmentOf(progress)).toBe('SENT');
    expect(fulfilmentSentence(progress)).toMatch(/Everything on this order has gone out/);
  });

  /**
   * THE REASON REVERSAL EXISTS RATHER THAN DELETION — and the reason it has to be
   * excluded here. A reversed load is still on the record; it is just not
   * something that happened to this buyer's order.
   */
  it('A REVERSED LOAD DOES NOT COUNT TOWARDS THE ORDER', () => {
    const progress = progressOf(lines, [
      dispatch({ id: 'd1', lines: [dline({ id: 'a', quantity: 6 })] }),
      dispatch({
        id: 'd2',
        lines: [dline({ id: 'b', quantity: 4 })],
        reversedAt: TODAY,
        reversalReason: 'Loaded onto the wrong vehicle',
      }),
    ]);
    expect(progress[0].dispatched).toBe(6);
    expect(fulfilmentOf(progress)).toBe('PART_SENT');
  });

  /**
   * OVER_SENT IS A REAL STATE. The store is short by two crates whatever the
   * order says, and rounding that away is how a ledger becomes the only place the
   * truth survives.
   */
  it('MORE THAN ORDERED IS REPORTED, NOT ROUNDED AWAY', () => {
    const progress = progressOf(lines, [dispatch({ lines: [dline({ quantity: 12 })] })]);
    expect(fulfilmentOf(progress)).toBe('OVER_SENT');
    expect(progress[0].over).toBe(2);
    expect(progress[0].outstanding).toBe(0);
    expect(fulfilmentSentence(progress)).toMatch(/store is short/i);
  });

  it('a line added at the gate counts against no order line', () => {
    const progress = progressOf(lines, [
      dispatch({ lines: [dline({ salesOrderLineId: null, quantity: 3 })] }),
    ]);
    expect(progress[0].dispatched).toBe(0);
    expect(dispatchedByLine([dispatch({ lines: [dline({ salesOrderLineId: null })] })]).size).toBe(0);
  });
});

describe('what may be dispatched against', () => {
  it('A DRAFT MAY NOT BE — nobody agreed it', () => {
    expect(canDispatch('DRAFT')).toBe(false);
    expect(whyNotDispatchable('DRAFT')).toMatch(/has not been confirmed/i);
  });

  it('nor may a cancelled one', () => {
    expect(canDispatch('CANCELLED')).toBe(false);
    expect(whyNotDispatchable('CANCELLED')).toMatch(/cancelled/i);
  });

  it('a confirmed one may', () => {
    expect(canDispatch('CONFIRMED')).toBe(true);
    expect(whyNotDispatchable('CONFIRMED')).toBeNull();
  });
});

describe('what cannot be recorded at all', () => {
  const base = {
    lines: [{ salesOrderLineId: 'ol1', productId: 'p1', quantity: 6, unitsPerPack: 30 }],
    method: 'COLLECTED',
    dispatchedOn: TODAY,
    today: TODAY,
  };

  it('accepts an ordinary load', () => {
    expect(dispatchErrors(base)).toEqual([]);
  });

  it('refuses an empty load', () => {
    expect(dispatchErrors({ ...base, lines: [] })[0]).toMatch(/Nothing is on this load/i);
  });

  it('HALF A CRATE IS REFUSED, and says what to record instead', () => {
    const problems = dispatchErrors({
      ...base,
      lines: [{ ...base.lines[0], quantity: 1.5 }],
    });
    expect(problems[0]).toMatch(/whole packs only/i);
    expect(problems[0]).toMatch(/record it as trays/i);
  });

  it('refuses a load that has not happened yet', () => {
    const problems = dispatchErrors({
      ...base,
      dispatchedOn: new Date(TODAY.getTime() + DAY),
    });
    expect(problems[0]).toMatch(/cannot go out in the future/i);
  });

  /**
   * A backdated stock issue silently changes what the store held on days people
   * have already looked at. Two months is generous; beyond it the honest record
   * is an adjustment dated today.
   */
  it('REFUSES A LOAD BACKDATED PAST THE POINT WHERE THE STORE WAS ALREADY READ', () => {
    const problems = dispatchErrors({
      ...base,
      dispatchedOn: new Date(TODAY.getTime() - 61 * DAY),
    });
    expect(problems[0]).toMatch(/two months/i);
    expect(problems[0]).toMatch(/adjustment/i);
  });

  it('accepts a load recorded a few days late — that is ordinary', () => {
    expect(dispatchErrors({ ...base, dispatchedOn: new Date(TODAY.getTime() - 3 * DAY) })).toEqual(
      [],
    );
  });

  it('refuses a method nobody chose', () => {
    expect(dispatchErrors({ ...base, method: '' })[0]).toMatch(/collected it or the farm delivered/i);
  });
});

describe('what makes somebody look twice, without stopping them', () => {
  const progress = progressOf([orderLine({ id: 'ol1', quantity: 10 })], []);

  it('an ordinary load raises nothing', () => {
    const warnings = dispatchWarnings({
      lines: [{ salesOrderLineId: 'ol1', productId: 'p1', quantity: 6, unitsPerPack: 30 }],
      progress,
      stock: [{ productId: 'p1', productName: 'Crate of 30 — Large', onHandBase: 600 }],
      method: 'COLLECTED',
      receivedBy: null,
    });
    expect(warnings).toEqual([]);
  });

  it('MORE THAN THE ORDER HAS OUTSTANDING WARNS, and the load still saves', () => {
    const warnings = dispatchWarnings({
      lines: [{ salesOrderLineId: 'ol1', productId: 'p1', quantity: 12, unitsPerPack: 30 }],
      progress,
      stock: [],
      method: 'COLLECTED',
      receivedBy: null,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/2 more crates/);
  });

  it('SHORT STOCK WARNS RATHER THAN REFUSES — the eggs have already gone', () => {
    const warnings = dispatchWarnings({
      lines: [{ salesOrderLineId: 'ol1', productId: 'p1', quantity: 6, unitsPerPack: 30 }],
      progress,
      stock: [{ productId: 'p1', productName: 'Crate of 30 — Large', onHandBase: 100 }],
      method: 'COLLECTED',
      receivedBy: null,
    });
    expect(warnings[0].message).toMatch(/only 100/);
    expect(warnings[0].message).toMatch(/needs 180/);
    expect(warnings[0].message).toMatch(/store will show short/i);
  });

  it('a product not held as stock raises nothing about stock', () => {
    const warnings = dispatchWarnings({
      lines: [{ salesOrderLineId: 'ol1', productId: 'p1', quantity: 6, unitsPerPack: 30 }],
      progress,
      stock: [{ productId: 'p1', productName: 'Spent hen', onHandBase: null }],
      method: 'COLLECTED',
      receivedBy: null,
    });
    expect(warnings).toEqual([]);
  });

  it('something added at the gate says it will not fulfil the order', () => {
    const warnings = dispatchWarnings({
      lines: [{ salesOrderLineId: null, productId: 'p9', quantity: 2, unitsPerPack: 30 }],
      progress,
      stock: [],
      method: 'COLLECTED',
      receivedBy: null,
    });
    expect(warnings[0].message).toMatch(/was not on the order/i);
    expect(warnings[0].message).toMatch(/come off the store/i);
  });

  it('A DELIVERY NOBODY SIGNED FOR IS WORTH ASKING ABOUT', () => {
    const warnings = dispatchWarnings({
      lines: [{ salesOrderLineId: 'ol1', productId: 'p1', quantity: 6, unitsPerPack: 30 }],
      progress,
      stock: [],
      method: 'DELIVERED',
      receivedBy: '   ',
    });
    expect(warnings.some((w) => w.field === 'receivedBy')).toBe(true);
  });

  it('but a collection needs no signature — the buyer is standing there', () => {
    const warnings = dispatchWarnings({
      lines: [{ salesOrderLineId: 'ol1', productId: 'p1', quantity: 6, unitsPerPack: 30 }],
      progress,
      stock: [],
      method: 'COLLECTED',
      receivedBy: null,
    });
    expect(warnings.some((w) => w.field === 'receivedBy')).toBe(false);
  });
});

describe('reversing a load', () => {
  it('NEEDS A REASON — two sets of movements with no explanation is worse than one wrong set', () => {
    expect(reversalErrors({ alreadyReversed: false, reason: '' })[0]).toMatch(/say why/i);
    expect(reversalErrors({ alreadyReversed: false, reason: 'Wrong vehicle' })).toEqual([]);
  });

  it('cannot happen twice', () => {
    expect(reversalErrors({ alreadyReversed: true, reason: 'Again' })[0]).toMatch(
      /already been reversed/i,
    );
  });

  it('says what happened, on the record', () => {
    const reversed = dispatch({
      reversedAt: TODAY,
      reversedByName: 'Owner',
      reversalReason: 'Loaded onto the wrong vehicle',
    });
    expect(isLive(reversed)).toBe(false);
    expect(reversalSentence(reversed)).toBe(
      'Reversed by Owner on 2026-09-11. Loaded onto the wrong vehicle',
    );
    expect(reversalSentence(dispatch())).toBe('');
  });
});

describe('reading a list of loads', () => {
  it('most recent first', () => {
    const older = dispatch({ id: 'a', dispatchedOn: new Date(TODAY.getTime() - DAY) });
    const newer = dispatch({ id: 'b', dispatchedOn: TODAY });
    expect(sortDispatches([older, newer]).map((d) => d.id)).toEqual(['b', 'a']);
  });

  it('summarises in eggs, and says how many were reversed', () => {
    const summary = dispatchSummary([
      dispatch({ id: 'a', lines: [dline({ quantity: 6 })] }),
      dispatch({ id: 'b', lines: [dline({ quantity: 4 })], reversedAt: TODAY }),
    ]);
    expect(summary).toContain('1 load');
    expect(summary).toContain('180');
    expect(summary).toContain('1 reversed');
  });

  it('says so plainly when nothing has gone out', () => {
    expect(dispatchSummary([])).toBe('Nothing has gone out yet.');
  });

  it('and distinguishes that from everything having been reversed', () => {
    expect(dispatchSummary([dispatch({ reversedAt: TODAY })])).toMatch(/every load recorded here was reversed/i);
  });
});
