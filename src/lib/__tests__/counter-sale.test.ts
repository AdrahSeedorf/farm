import { describe, it, expect } from 'vitest';
import {
  buyerErrors,
  buyerSentence,
  counterSaleErrors,
  saleTotal,
  saleBaseUnits,
  saleSentence,
  counterSaleNote,
  COUNTER_BUYER_NAME,
  COUNTER_BUYER_NOTE,
  type SellableProduct,
  type CounterLineInput,
} from '@/lib/counter-sale';
import { fromCedis, formatGHS } from '@/lib/money';

function product(over: Partial<SellableProduct> = {}): SellableProduct {
  return {
    id: over.id ?? 'p1',
    name: over.name ?? 'Crate of 30 — Large',
    packLabel: over.packLabel ?? 'crate',
    unitsPerPack: over.unitsPerPack ?? 30,
    pricePesewas: over.pricePesewas === undefined ? fromCedis(45) : over.pricePesewas,
    onHandBase: over.onHandBase === undefined ? 600 : over.onHandBase,
  };
}

function line(over: Partial<CounterLineInput> = {}): CounterLineInput {
  return {
    productId: over.productId ?? 'p1',
    quantity: over.quantity ?? 2,
    pricePesewas: over.pricePesewas === undefined ? null : over.pricePesewas,
  };
}

describe('who bought it', () => {
  it('an existing buyer needs to actually be chosen', () => {
    expect(buyerErrors({ mode: 'EXISTING', customerId: '' })[0]).toMatch(/which buyer/i);
    expect(buyerErrors({ mode: 'EXISTING', customerId: 'c1' })).toEqual([]);
  });

  /**
   * THE SAME RULE THE BUYER FORM USES. Two definitions of "a valid buyer" would
   * drift until the same person could be added on one screen and refused on the
   * other.
   */
  it('a new buyer is a name and a number, written however they write it', () => {
    expect(buyerErrors({ mode: 'NEW', name: 'Kofi', phone: '024 477 8899' })).toEqual([]);
    expect(buyerErrors({ mode: 'NEW', name: 'Kofi', phone: '0244778899' })).toEqual([]);
    expect(buyerErrors({ mode: 'NEW', name: '', phone: '0244778899' })[0]).toMatch(/name/i);
    expect(buyerErrors({ mode: 'NEW', name: 'Kofi', phone: '12' })[0]).toMatch(/number/i);
  });

  /**
   * A STRANGER PAYING CASH IS NOT AN ERROR. Refusing the sale does not stop the
   * crates leaving; it just stops anybody knowing they did.
   */
  it('A CASH SALE TO A STRANGER NEEDS NOTHING AT ALL', () => {
    expect(buyerErrors({ mode: 'COUNTER' })).toEqual([]);
  });

  it('and says plainly that the standing row is not a person to ring', () => {
    expect(buyerSentence({ mode: 'COUNTER' })).toMatch(/nobody to ring/i);
    expect(buyerSentence({ mode: 'COUNTER' })).toMatch(/come off the store/i);
    expect(COUNTER_BUYER_NAME).toBe('Counter sale');
    expect(COUNTER_BUYER_NOTE).toMatch(/not a person/i);
    expect(COUNTER_BUYER_NOTE).toMatch(/do not try to ring it/i);
  });

  it('a new buyer is told they are being kept', () => {
    expect(buyerSentence({ mode: 'NEW' })).toMatch(/added to the buyer list/i);
  });
});

describe('what stops a gate sale being recorded', () => {
  const products = [product()];

  it('accepts an ordinary sale', () => {
    expect(counterSaleErrors({ lines: [line()], products })).toEqual([]);
  });

  it('refuses an empty one', () => {
    expect(counterSaleErrors({ lines: [line({ quantity: 0 })], products })[0]).toMatch(
      /nothing is on this sale/i,
    );
  });

  it('HALF A CRATE IS REFUSED, with what to sell instead — the same rule everywhere', () => {
    const problems = counterSaleErrors({ lines: [line({ quantity: 1.5 })], products });
    expect(problems[0]).toMatch(/whole packs only/i);
    expect(problems[0]).toMatch(/sell them trays instead/i);
  });

  it('refuses a product with no price at all, and says how to fix it', () => {
    const problems = counterSaleErrors({
      lines: [line()],
      products: [product({ pricePesewas: null })],
    });
    expect(problems[0]).toMatch(/has no price/i);
    expect(problems[0]).toMatch(/type what they paid/i);
  });

  /** Haggling at a gate is real: a typed price rescues an unpriced product. */
  it('BUT A PRICE TYPED AT THE GATE IS ENOUGH ON ITS OWN', () => {
    expect(
      counterSaleErrors({
        lines: [line({ pricePesewas: fromCedis(40) })],
        products: [product({ pricePesewas: null })],
      }),
    ).toEqual([]);
  });

  it('refuses a negative price', () => {
    expect(
      counterSaleErrors({ lines: [line({ pricePesewas: fromCedis(-5) })], products })[0],
    ).toMatch(/cannot be negative/i);
  });

  /**
   * THIN STOCK IS NOT AN ERROR HERE. The dispatch layer this composes onto warns
   * about it and records what happened, because the crates are in the buyer's car
   * by the time anybody types anything.
   */
  it('says nothing about the store being short — that is a warning, not a refusal', () => {
    expect(
      counterSaleErrors({ lines: [line({ quantity: 40 })], products: [product({ onHandBase: 30 })] }),
    ).toEqual([]);
  });
});

describe('what to read back before money changes hands', () => {
  const products = [product(), product({ id: 'p2', name: 'Tray of 12', packLabel: 'tray', unitsPerPack: 12, pricePesewas: fromCedis(20) })];

  it('totals at the list price when nothing was typed', () => {
    expect(formatGHS(saleTotal([line({ quantity: 2 })], products))).toBe('GHS 90.00');
  });

  it('A TYPED PRICE WINS — that is the figure that will be recorded', () => {
    expect(
      formatGHS(saleTotal([line({ quantity: 2, pricePesewas: fromCedis(40) })], products)),
    ).toBe('GHS 80.00');
  });

  it('adds across products', () => {
    const lines = [line({ quantity: 2 }), line({ productId: 'p2', quantity: 3 })];
    expect(formatGHS(saleTotal(lines, products))).toBe('GHS 150.00');
    expect(saleBaseUnits(lines, products)).toBe(96);
  });

  /**
   * SAID IN BOTH THE PACK AND THE THING. The buyer counted crates; the
   * storekeeper is about to watch sixty eggs leave.
   */
  it('reads back in crates, in eggs and in money', () => {
    const sentence = saleSentence([line({ quantity: 2 })], products);
    expect(sentence).toContain('2 crates');
    expect(sentence).toContain('60 in all');
    expect(sentence).toContain('GHS 90.00');
  });

  it('gets the singular right', () => {
    expect(saleSentence([line({ quantity: 1 })], products)).toContain('1 crate of');
  });

  it('says so plainly when nothing is on it', () => {
    expect(saleSentence([], products)).toBe('Nothing on it yet.');
    expect(saleBaseUnits([], products)).toBe(0);
    expect(formatGHS(saleTotal([], products))).toBe('GHS 0.00');
  });
});

describe('the note left on the order', () => {
  /**
   * A confirmed order dispatched in the same minute it was written looks odd on
   * the slow screens until it says why.
   */
  it('EXPLAINS ITSELF TO SOMEBODY READING IT NEXT MONTH', () => {
    expect(counterSaleNote('COUNTER')).toMatch(/sold at the gate for cash/i);
    expect(counterSaleNote('COUNTER')).toMatch(/no buyer details/i);
    expect(counterSaleNote('EXISTING')).toBe('Sold at the gate.');
  });
});
