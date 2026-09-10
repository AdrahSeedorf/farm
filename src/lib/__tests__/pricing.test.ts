import { describe, it, expect } from 'vitest';
import {
  priceFor,
  nextPrice,
  priceBasisSentence,
  packQuantity,
  baseUnits,
  lineTotal,
  linesTotal,
  quote,
  productErrors,
  priceErrors,
  type Product,
  type PriceRow,
} from '@/lib/pricing';
import { pesewas, fromCedis, formatGHS } from '@/lib/money';

const DAY = 86_400_000;
const NOW = new Date('2026-06-15T00:00:00.000Z');

function product(over: Partial<Product> = {}): Product {
  return {
    id: over.id ?? 'p1',
    name: over.name ?? 'Crate of 30 — Large',
    sku: over.sku ?? 'CRATE-L',
    gradeId: over.gradeId ?? null,
    gradeName: over.gradeName ?? null,
    unitsPerPack: over.unitsPerPack ?? 30,
    packLabel: over.packLabel ?? 'crate',
    isActive: over.isActive ?? true,
    notes: over.notes ?? null,
  };
}

let seq = 0;
function price(over: Partial<PriceRow> = {}): PriceRow {
  seq += 1;
  return {
    id: over.id ?? `pr${seq}`,
    productId: over.productId ?? 'p1',
    customerId: over.customerId ?? null,
    pricePesewas: over.pricePesewas === undefined ? fromCedis(40) : over.pricePesewas,
    effectiveFrom: over.effectiveFrom ?? new Date('2026-01-01T00:00:00.000Z'),
    note: over.note ?? null,
    setByName: over.setByName ?? null,
    createdAt: over.createdAt ?? new Date(`2026-01-0${(seq % 9) + 1}T00:00:00.000Z`),
  };
}

describe('what a buyer pays', () => {
  it('is the list price when there is nothing else', () => {
    const resolved = priceFor([price()], { productId: 'p1', customerId: null, on: NOW });
    expect(resolved?.pricePesewas).toBe(fromCedis(40));
    expect(resolved?.isCustomerPrice).toBe(false);
  });

  // A PRICE AGREED TO START NEXT MONDAY IS NOT TODAY'S PRICE.
  it('IGNORES A ROW DATED IN THE FUTURE', () => {
    const rows = [
      price({ pricePesewas: fromCedis(40) }),
      price({ pricePesewas: fromCedis(50), effectiveFrom: new Date(NOW.getTime() + 7 * DAY) }),
    ];
    expect(priceFor(rows, { productId: 'p1', customerId: null, on: NOW })?.pricePesewas).toBe(
      fromCedis(40),
    );
  });

  it('takes the newest row that has started', () => {
    const rows = [
      price({ pricePesewas: fromCedis(40), effectiveFrom: new Date('2026-01-01') }),
      price({ pricePesewas: fromCedis(45), effectiveFrom: new Date('2026-05-01') }),
    ];
    expect(priceFor(rows, { productId: 'p1', customerId: null, on: NOW })?.pricePesewas).toBe(
      fromCedis(45),
    );
  });

  // THE WHOLE REASON PRICES ARE ROWS. A May invoice must still add up after a
  // June rise, or the farm has a bookkeeping problem nobody can fix.
  it('STILL ANSWERS FOR A DAY IN THE PAST', () => {
    const rows = [
      price({ pricePesewas: fromCedis(40), effectiveFrom: new Date('2026-01-01') }),
      price({ pricePesewas: fromCedis(45), effectiveFrom: new Date('2026-06-01') }),
    ];
    const inMay = priceFor(rows, {
      productId: 'p1',
      customerId: null,
      on: new Date('2026-05-20'),
    });
    expect(inMay?.pricePesewas).toBe(fromCedis(40));
  });

  it('breaks a same-day tie on which was entered last', () => {
    const sameDay = new Date('2026-05-01');
    const rows = [
      price({
        pricePesewas: fromCedis(45),
        effectiveFrom: sameDay,
        createdAt: new Date('2026-05-01T09:00:00Z'),
      }),
      price({
        pricePesewas: fromCedis(46),
        effectiveFrom: sameDay,
        createdAt: new Date('2026-05-01T11:00:00Z'),
      }),
    ];
    expect(priceFor(rows, { productId: 'p1', customerId: null, on: NOW })?.pricePesewas).toBe(
      fromCedis(46),
    );
  });

  it('is nothing at all when the product has never been priced', () => {
    expect(priceFor([], { productId: 'p1', customerId: null, on: NOW })).toBeNull();
  });

  // NULL, NOT ZERO. A quote of GHS 0.00 is one somebody might act on.
  it('DOES NOT FALL BACK TO ZERO', () => {
    const resolved = priceFor([price({ productId: 'other' })], {
      productId: 'p1',
      customerId: null,
      on: NOW,
    });
    expect(resolved).toBeNull();
  });
});

describe('a buyer with their own price', () => {
  const rows = [
    price({ pricePesewas: fromCedis(50), effectiveFrom: new Date('2026-01-01') }),
    price({
      customerId: 'c1',
      pricePesewas: fromCedis(45),
      effectiveFrom: new Date('2026-02-01'),
    }),
  ];

  // Wholesale is agreed per buyer, and that has to survive the list moving.
  it('BEATS THE LIST PRICE', () => {
    const mine = priceFor(rows, { productId: 'p1', customerId: 'c1', on: NOW });
    expect(mine?.pricePesewas).toBe(fromCedis(45));
    expect(mine?.isCustomerPrice).toBe(true);
  });

  it('leaves everybody else on the list price', () => {
    const theirs = priceFor(rows, { productId: 'p1', customerId: 'c2', on: NOW });
    expect(theirs?.pricePesewas).toBe(fromCedis(50));
    expect(theirs?.isCustomerPrice).toBe(false);
  });

  it('holds even when the list price rises afterwards', () => {
    const withRise = [
      ...rows,
      price({ pricePesewas: fromCedis(60), effectiveFrom: new Date('2026-05-01') }),
    ];
    expect(priceFor(withRise, { productId: 'p1', customerId: 'c1', on: NOW })?.pricePesewas).toBe(
      fromCedis(45),
    );
  });

  // THE STEP WORTH READING TWICE. An ended agreement falls through to the list
  // rather than leaving the buyer with no price at all.
  it('FALLS BACK TO THE LIST WHEN THE AGREEMENT IS ENDED', () => {
    const ended = [
      ...rows,
      price({ customerId: 'c1', pricePesewas: null, effectiveFrom: new Date('2026-05-01') }),
    ];
    const after = priceFor(ended, { productId: 'p1', customerId: 'c1', on: NOW });
    expect(after?.pricePesewas).toBe(fromCedis(50));
    expect(after?.isCustomerPrice).toBe(false);
  });

  it('and the ending does not apply before its date', () => {
    const ended = [
      ...rows,
      price({ customerId: 'c1', pricePesewas: null, effectiveFrom: new Date('2026-05-01') }),
    ];
    const inMarch = priceFor(ended, {
      productId: 'p1',
      customerId: 'c1',
      on: new Date('2026-03-15'),
    });
    expect(inMarch?.pricePesewas).toBe(fromCedis(45));
  });
});

describe('a change not yet in force', () => {
  it('is reported so nobody is surprised on the day', () => {
    const rows = [
      price({ pricePesewas: fromCedis(40) }),
      price({
        pricePesewas: fromCedis(45),
        effectiveFrom: new Date(NOW.getTime() + 10 * DAY),
      }),
    ];
    expect(
      nextPrice(rows, { productId: 'p1', customerId: null, on: NOW })?.pricePesewas,
    ).toBe(fromCedis(45));
  });

  it('is nothing when nothing is coming', () => {
    expect(nextPrice([price()], { productId: 'p1', customerId: null, on: NOW })).toBeNull();
  });
});

describe('saying where a price came from', () => {
  it('names the buyer agreement', () => {
    const rows = [price({ customerId: 'c1', pricePesewas: fromCedis(45), setByName: 'Owner' })];
    const resolved = priceFor(rows, { productId: 'p1', customerId: 'c1', on: NOW });
    expect(priceBasisSentence(resolved)).toMatch(/Agreed with this buyer by Owner/);
  });

  it('says plainly when there is no price', () => {
    expect(priceBasisSentence(null)).toMatch(/Nothing can be quoted/);
  });
});

describe('arithmetic', () => {
  it('counts packs in words', () => {
    expect(packQuantity(product(), 1)).toBe('1 crate');
    expect(packQuantity(product(), 3)).toBe('3 crates');
  });

  // "3 crates" is what somebody orders; "90 eggs" is what leaves the store.
  it('SAYS THE SAME QUANTITY IN THE THING ITSELF', () => {
    expect(baseUnits(product(), 3)).toBe(90);
    expect(baseUnits(product({ unitsPerPack: 1, packLabel: 'bird' }), 4)).toBe(4);
  });

  it('multiplies in integer pesewas', () => {
    expect(lineTotal({ quantity: 3, unitPricePesewas: fromCedis(45) })).toBe(fromCedis(135));
    expect(
      linesTotal([
        { quantity: 3, unitPricePesewas: fromCedis(45) },
        { quantity: 2, unitPricePesewas: fromCedis(40) },
      ]),
    ).toBe(fromCedis(215));
  });

  it('handles a price with pesewas in it exactly', () => {
    // 3 × 45.50 = 136.50, and no float drift.
    expect(lineTotal({ quantity: 3, unitPricePesewas: fromCedis(45.5) })).toBe(fromCedis(136.5));
    expect(formatGHS(lineTotal({ quantity: 3, unitPricePesewas: fromCedis(45.5) }))).toContain(
      '136.50',
    );
  });

  it('totals an empty order to zero rather than throwing', () => {
    expect(linesTotal([])).toBe(pesewas(0));
  });

  it('quotes in words a buyer would recognise', () => {
    const resolved = priceFor([price({ pricePesewas: fromCedis(45) })], {
      productId: 'p1',
      customerId: null,
      on: NOW,
    });
    expect(quote(product(), resolved, 3)?.sentence).toBe(
      '3 crates at GHS 45.00 = GHS 135.00',
    );
  });

  it('refuses to quote what has no price', () => {
    expect(quote(product(), null, 3)).toBeNull();
    const resolved = priceFor([price()], { productId: 'p1', customerId: null, on: NOW });
    expect(quote(product(), resolved, 0)).toBeNull();
  });
});

describe('validation', () => {
  const ok = { name: 'Crate of 30', sku: 'CRATE-L', unitsPerPack: 30, packLabel: 'crate' };

  it('accepts a sensible product', () => {
    expect(productErrors(ok)).toEqual([]);
  });

  it('refuses a code with spaces', () => {
    expect(productErrors({ ...ok, sku: 'CRATE L' })[0]).toMatch(/no spaces/);
  });

  // A crate of 100,000 eggs would multiply every figure built on it.
  it('CATCHES A PACK SIZE THAT IS PLAINLY A TYPO', () => {
    expect(productErrors({ ...ok, unitsPerPack: 100_000 })[0]).toMatch(/very large pack/);
    expect(productErrors({ ...ok, unitsPerPack: 0 })[0]).toMatch(/at least one/);
  });

  it('accepts a backdated price', () => {
    expect(
      priceErrors(
        { pricePesewas: fromCedis(45), effectiveFrom: new Date(NOW.getTime() - 7 * DAY) },
        NOW,
      ),
    ).toEqual([]);
  });

  it('refuses a date so old it is a typo', () => {
    expect(
      priceErrors(
        { pricePesewas: fromCedis(45), effectiveFrom: new Date('2019-01-01') },
        NOW,
      )[0],
    ).toMatch(/two years back/);
  });

  it('refuses a negative price', () => {
    expect(
      priceErrors({ pricePesewas: pesewas(-100), effectiveFrom: NOW }, NOW)[0],
    ).toMatch(/negative/);
  });

  // A ZERO IS ALLOWED ONLY WITH A REASON. A farm does give a crate away; an
  // unexplained zero is a slipped keystroke that costs the whole line.
  it('REFUSES AN UNEXPLAINED ZERO BUT ALLOWS A DELIBERATE ONE', () => {
    expect(priceErrors({ pricePesewas: pesewas(0), effectiveFrom: NOW }, NOW)[0]).toMatch(
      /say why in the note/i,
    );
    expect(
      priceErrors(
        { pricePesewas: pesewas(0), effectiveFrom: NOW, note: 'Sample crate for Serwaa' },
        NOW,
      ),
    ).toEqual([]);
  });

  it('accepts an ended agreement, which has no price at all', () => {
    expect(priceErrors({ pricePesewas: null, effectiveFrom: NOW }, NOW)).toEqual([]);
  });
});
