import { describe, it, expect } from 'vitest';
import {
  ORDER_STATES,
  ORDER_STATE_LABELS,
  FULFILMENT_LABELS,
  lineTotal,
  orderTotal,
  outstandingOf,
  overOf,
  fulfilmentOf,
  outstandingLines,
  fulfilmentSentence,
  priceVariance,
  priceVarianceSentence,
  suggestedDelivery,
  orderTiming,
  timingSentence,
  checkReceiptAgainstOrder,
  orderErrors,
  type OrderLine,
} from '../purchasing';
import { fromCedis } from '../money';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const line = (over: Partial<OrderLine> = {}): OrderLine => ({
  itemId: 'feed',
  itemName: 'Layer mash',
  quantityOrdered: 20,
  unitKey: 'bag',
  unitPricePesewas: fromCedis(260),
  quantityReceived: 0,
  ...over,
});

describe('what an order was expected to cost', () => {
  it('prices a line per ORDERED unit', () => {
    // A farm agrees a price per bag. Translating that to a price per kilogram
    // before storing it means every screen has to translate it back, and one
    // of them eventually will not.
    expect(lineTotal(line())).toBe(fromCedis(5_200));
  });

  it('adds the lines up', () => {
    expect(
      orderTotal([
        line(),
        line({ itemId: 'grit', itemName: 'Oyster grit', quantityOrdered: 4, unitPricePesewas: fromCedis(90) }),
      ]),
    ).toBe(fromCedis(5_560));
  });

  it('handles a fractional quantity without losing pesewas', () => {
    expect(lineTotal({ quantityOrdered: 2.5, unitPricePesewas: 333 })).toBe(833);
  });

  it('is nothing for an empty order', () => {
    expect(orderTotal([])).toBe(0);
  });
});

describe('where an order stands', () => {
  it('KEEPS THE LIFECYCLE AND THE FULFILMENT APART', () => {
    // DRAFT, SENT and CANCELLED are things a person DID. "Received" is what the
    // receipts add up to — storing it as a status is how a status column comes
    // to disagree with the rows beneath it.
    expect(ORDER_STATES).toEqual(['DRAFT', 'SENT', 'CANCELLED']);
    expect(ORDER_STATES).not.toContain('RECEIVED');
    for (const s of ORDER_STATES) expect(ORDER_STATE_LABELS[s].length).toBeGreaterThan(0);
    for (const f of ['NOTHING', 'PART', 'COMPLETE', 'OVER'] as const) {
      expect(FULFILMENT_LABELS[f].length).toBeGreaterThan(0);
    }
  });

  it('says nothing came when nothing came', () => {
    expect(fulfilmentOf([line()])).toBe('NOTHING');
  });

  it('says part when some came', () => {
    expect(fulfilmentOf([line({ quantityReceived: 12 })])).toBe('PART');
    expect(outstandingOf(line({ quantityReceived: 12 }))).toBe(8);
  });

  it('says complete when all of it came', () => {
    expect(fulfilmentOf([line({ quantityReceived: 20 })])).toBe('COMPLETE');
    expect(outstandingOf(line({ quantityReceived: 20 }))).toBe(0);
  });

  it('OVER BEATS COMPLETE, so a mixed order does not read as a tick', () => {
    // One line short, one line long, is not "complete". It is an order somebody
    // needs to look at.
    const lines = [
      line({ quantityReceived: 21 }),
      line({ itemId: 'grit', itemName: 'Grit', quantityOrdered: 4, quantityReceived: 3 }),
    ];
    expect(fulfilmentOf(lines)).toBe('OVER');
    expect(overOf(lines[0])).toBe(1);
  });

  it('an over-delivery is not a negative shortfall', () => {
    expect(outstandingOf(line({ quantityReceived: 25 }))).toBe(0);
    expect(overOf(line({ quantityReceived: 25 }))).toBe(5);
  });

  it('lists what is still to come, for the chasing list', () => {
    const lines = [
      line({ quantityReceived: 20 }),
      line({ itemId: 'grit', itemName: 'Grit', quantityOrdered: 4, quantityReceived: 1 }),
    ];
    expect(outstandingLines(lines).map((l) => l.itemName)).toEqual(['Grit']);
  });

  it('writes each state as a sentence a person can act on', () => {
    expect(fulfilmentSentence([line()])).toMatch(/nothing has been received/i);
    expect(fulfilmentSentence([line({ quantityReceived: 20 })])).toMatch(/received in full|everything ordered/i);
    expect(fulfilmentSentence([line({ quantityReceived: 12 })])).toMatch(/still to come: 8 bag Layer mash/i);
    expect(fulfilmentSentence([line({ quantityReceived: 21 })])).toMatch(
      /1 bag more Layer mash arrived than was ordered/,
    );
  });
});

describe('what it actually cost', () => {
  it('reports the gap between the order and the invoice', () => {
    const v = priceVariance(fromCedis(260), fromCedis(275))!;
    expect(v.differencePesewas).toBe(fromCedis(15));
    expect(v.dearer).toBe(true);
    expect(v.pctOfOrdered).toBeCloseTo(5.77, 1);
  });

  it('and the other way', () => {
    expect(priceVariance(fromCedis(260), fromCedis(250))!.dearer).toBe(false);
  });

  it('REPORTS NOTHING WHEN NO PRICE WAS AGREED', () => {
    // Plenty of deliveries on a small farm are arranged by phone with the price
    // settled on arrival. Reporting a variance against nothing invents one.
    expect(priceVariance(null, fromCedis(275))).toBeNull();
    expect(priceVariance(fromCedis(260), null)).toBeNull();
  });

  it('says it in words', () => {
    const v = priceVariance(fromCedis(260), fromCedis(275))!;
    expect(priceVarianceSentence(v, 'Layer mash', 'bag')).toMatch(
      /GHS 15\.00 \(6%\) dearer per bag/,
    );
  });

  it('says so plainly when the price held', () => {
    const v = priceVariance(fromCedis(260), fromCedis(260))!;
    expect(priceVarianceSentence(v, 'Layer mash', 'bag')).toMatch(/at the price agreed/i);
  });
});

describe('when it should arrive', () => {
  it('SUGGESTS a date from the lead time, and only suggests', () => {
    expect(suggestedDelivery(d('2026-09-04'), 14)?.toISOString().slice(0, 10)).toBe('2026-09-18');
  });

  it('suggests nothing when no lead time is set', () => {
    expect(suggestedDelivery(d('2026-09-04'), null)).toBeNull();
    expect(suggestedDelivery(d('2026-09-04'), 0)).toBeNull();
  });

  it('MEASURES LATENESS AGAINST THE AGREED DATE, not the average', () => {
    // Measuring against an average makes every order from a slow supplier
    // permanently late and every order from a fast one permanently early,
    // which tells nobody anything.
    const late = orderTiming(d('2026-09-01'), d('2026-09-04'));
    expect(late.status).toBe('LATE');
    expect(late.daysLate).toBe(3);
  });

  it('counts down before the date', () => {
    const soon = orderTiming(d('2026-09-10'), d('2026-09-04'));
    expect(soon.status).toBe('DUE_LATER');
    expect(soon.daysToGo).toBe(6);
  });

  it('and calls the day itself due today, not late', () => {
    expect(orderTiming(d('2026-09-04'), d('2026-09-04')).status).toBe('DUE_TODAY');
  });

  it('says nothing when no date was agreed', () => {
    expect(orderTiming(null, d('2026-09-04')).status).toBe('NO_DATE');
    expect(timingSentence(orderTiming(null))).toMatch(/no delivery date was agreed/i);
  });

  it('writes each state as a sentence', () => {
    expect(timingSentence(orderTiming(d('2026-09-01'), d('2026-09-04')))).toBe(
      '3 days past the agreed date.',
    );
    expect(timingSentence(orderTiming(d('2026-09-05'), d('2026-09-04')))).toBe('Due in 1 day.');
  });
});

describe('what is said before signing for a delivery', () => {
  it('says nothing about an ordinary delivery', () => {
    expect(
      checkReceiptAgainstOrder({
        orderState: 'SENT',
        line: line(),
        quantityNow: 20,
        unitPricePesewas: fromCedis(260),
      }),
    ).toEqual([]);
  });

  it('WARNS ABOUT AN OVER-DELIVERY BUT NEVER REFUSES IT', () => {
    // Refusing to record the twenty-first bag does not send it back. It just
    // means the store is wrong by one bag and nobody knows why.
    const w = checkReceiptAgainstOrder({
      orderState: 'SENT',
      line: line(),
      quantityNow: 21,
      unitPricePesewas: fromCedis(260),
    });
    expect(w).toHaveLength(1);
    expect(w[0].message).toMatch(/1 more than the order/);
    expect(w[0].message).toMatch(/check the delivery note/i);
  });

  it('counts what is already received when judging an over-delivery', () => {
    const w = checkReceiptAgainstOrder({
      orderState: 'SENT',
      line: line({ quantityReceived: 18 }),
      quantityNow: 5,
      unitPricePesewas: fromCedis(260),
    });
    expect(w[0].message).toMatch(/3 more than the order/);
  });

  it('flags a price a tenth away from what was agreed', () => {
    const w = checkReceiptAgainstOrder({
      orderState: 'SENT',
      line: line(),
      quantityNow: 20,
      unitPricePesewas: fromCedis(300),
    });
    expect(w.some((x) => /dearer per bag/.test(x.message))).toBe(true);
  });

  it('but not a small market move', () => {
    const w = checkReceiptAgainstOrder({
      orderState: 'SENT',
      line: line(),
      quantityNow: 20,
      unitPricePesewas: fromCedis(272),
    });
    expect(w).toEqual([]);
  });

  it('says something about receiving against a draft, without refusing', () => {
    const w = checkReceiptAgainstOrder({
      orderState: 'DRAFT',
      line: line(),
      quantityNow: 20,
      unitPricePesewas: fromCedis(260),
    });
    expect(w[0].message).toMatch(/has not been sent/i);
    expect(w[0].message).toMatch(/which is fine/i);
  });

  it('and about a cancelled one, more sharply', () => {
    const w = checkReceiptAgainstOrder({
      orderState: 'CANCELLED',
      line: line(),
      quantityNow: 20,
      unitPricePesewas: fromCedis(260),
    });
    expect(w[0].message).toMatch(/was cancelled/i);
    expect(w[0].message).toMatch(/record them/i);
  });
});

describe('what will not be saved', () => {
  it('accepts a sound order', () => {
    expect(orderErrors([line()])).toEqual([]);
  });

  it('refuses an order with no lines', () => {
    expect(orderErrors([])[0]).toMatch(/at least one line/i);
  });

  it('refuses a line with no quantity', () => {
    expect(orderErrors([line({ quantityOrdered: 0 })])[0]).toMatch(/above zero/i);
  });

  it('REFUSES THE SAME ITEM TWICE', () => {
    // Two lines for one item make every "what is still outstanding" figure
    // ambiguous, and the receiving screen would not know which to draw down.
    expect(orderErrors([line(), line()])[0]).toMatch(/on this order twice/i);
  });
});
