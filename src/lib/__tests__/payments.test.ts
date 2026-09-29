import { describe, it, expect } from 'vitest';
import {
  PAYMENT_METHODS,
  METHOD_LABELS,
  wantsReference,
  isLive,
  receivedTotal,
  balanceOf,
  balanceSentence,
  isInDebt,
  paymentErrors,
  paymentWarnings,
  reversalErrors,
  sortPayments,
  paymentSummary,
  referenceFor,
  sequenceOf,
  type Payment,
} from '@/lib/payments';
import type { SalesOrder, OrderLine } from '@/lib/sales';
import { fromCedis, formatGHS, type Pesewas } from '@/lib/money';

const DAY = 86_400_000;
const TODAY = new Date('2026-09-29T00:00:00.000Z');

function line(over: Partial<OrderLine> = {}): OrderLine {
  return {
    id: over.id ?? 'l1',
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

function order(over: Partial<SalesOrder> = {}): SalesOrder {
  const lines = over.lines ?? [line()];
  return {
    id: over.id ?? 'so1',
    orderNumber: over.orderNumber ?? 'SO-2026-0001',
    state: over.state ?? 'CONFIRMED',
    customerId: over.customerId ?? 'c1',
    customerName: over.customerName ?? 'Serwaa Cold Store',
    customerPhone: over.customerPhone ?? '+233209998887',
    siteId: over.siteId ?? 's1',
    siteName: over.siteName ?? 'Main farm',
    orderedOn: over.orderedOn ?? TODAY,
    wantedOn: over.wantedOn ?? null,
    drawnFromFlockId: over.drawnFromFlockId ?? null,
    drawnFromFlockName: over.drawnFromFlockName ?? null,
    notes: over.notes ?? null,
    lines,
    totalPesewas: over.totalPesewas ?? fromCedis(450),
    createdByName: over.createdByName ?? null,
    confirmedAt: over.confirmedAt ?? TODAY,
    confirmedByName: over.confirmedByName ?? null,
    cancelledAt: over.cancelledAt ?? null,
    cancelledByName: over.cancelledByName ?? null,
    cancelReason: over.cancelReason ?? null,
  };
}

function payment(over: Partial<Payment> = {}): Payment {
  return {
    id: over.id ?? 'pay1',
    reference: over.reference === undefined ? 'PAY-2026-0001' : over.reference,
    customerId: over.customerId ?? 'c1',
    customerName: over.customerName ?? 'Serwaa Cold Store',
    amountPesewas: over.amountPesewas ?? fromCedis(200),
    method: over.method ?? 'MOMO',
    receivedOn: over.receivedOn ?? TODAY,
    receivedBy: over.receivedBy === undefined ? null : over.receivedBy,
    notes: over.notes ?? null,
    recordedByName: over.recordedByName ?? 'Owner',
    createdAt: over.createdAt ?? TODAY,
    reversedAt: over.reversedAt ?? null,
    reversedByName: over.reversedByName ?? null,
    reversalReason: over.reversalReason ?? null,
  };
}

describe('how the money arrived', () => {
  it('covers the ways a Ghanaian farm is actually paid', () => {
    expect(PAYMENT_METHODS).toEqual(['CASH', 'MOMO', 'CARD', 'BANK']);
    expect(METHOD_LABELS.MOMO).toBe('Mobile money');
  });

  /**
   * CASH IS THE ONE THAT LEAVES NO TRACE ANYWHERE ELSE. There is no transaction
   * ID for notes in a hand, which is why the name of whoever took it matters.
   */
  it('ONLY CASH IS WITHOUT A REFERENCE', () => {
    expect(wantsReference('CASH')).toBe(false);
    expect(wantsReference('MOMO')).toBe(true);
    expect(wantsReference('CARD')).toBe(true);
    expect(wantsReference('BANK')).toBe(true);
  });

  it('gives a receipt number that can be read aloud', () => {
    expect(referenceFor(2026, 7)).toBe('PAY-2026-0007');
    expect(sequenceOf(referenceFor(2026, 42), 2026)).toBe(42);
    expect(sequenceOf('PAY-2025-0042', 2026)).toBe(0);
  });
});

describe('what a buyer owes', () => {
  /** owed = agreed on confirmed orders − payments received */
  it('is what was agreed less what came in', () => {
    const balance = balanceOf([order()], [payment({ amountPesewas: fromCedis(200) })]);
    expect(formatGHS(balance.committedPesewas)).toBe('GHS 450.00');
    expect(formatGHS(balance.receivedPesewas)).toBe('GHS 200.00');
    expect(formatGHS(balance.owedPesewas)).toBe('GHS 250.00');
    expect(isInDebt(balance)).toBe(true);
  });

  /**
   * A DRAFT IS NOT A DEBT. Somebody started it and never agreed it with the
   * buyer; charging for it would put a figure on screen a farm would chase.
   */
  it('DRAFTS AND CANCELLED ORDERS ARE NOT DEBTS', () => {
    const balance = balanceOf(
      [
        order({ id: 'a', state: 'CONFIRMED' }),
        order({ id: 'b', state: 'DRAFT' }),
        order({ id: 'c', state: 'CANCELLED' }),
      ],
      [],
    );
    expect(formatGHS(balance.committedPesewas)).toBe('GHS 450.00');
    expect(balance.confirmedOrders).toBe(1);
  });

  it('a reversed payment does not count as received', () => {
    const balance = balanceOf(
      [order()],
      [
        payment({ id: 'a', amountPesewas: fromCedis(200) }),
        payment({ id: 'b', amountPesewas: fromCedis(100), reversedAt: TODAY }),
      ],
    );
    expect(formatGHS(balance.receivedPesewas)).toBe('GHS 200.00');
    expect(balance.livePayments).toBe(1);
  });

  /**
   * PAYING AHEAD IS REAL. Wholesale buyers do it, and clamping the figure to
   * zero would lose the fact that the farm is holding somebody's money.
   */
  it('A NEGATIVE BALANCE IS KEPT, NOT CLAMPED', () => {
    const balance = balanceOf([order()], [payment({ amountPesewas: fromCedis(600) })]);
    expect(balance.owedPesewas).toBe(fromCedis(-150));
    expect(isInDebt(balance)).toBe(false);
    expect(balanceSentence(balance)).toMatch(/paid GHS 150\.00 ahead/i);
  });

  /**
   * A screen that prints "owes GHS 0.00" invites somebody to ring a customer
   * who owes nothing.
   */
  it('THE WORD "OWES" IS ONLY USED WHEN SOMETHING IS OWED', () => {
    const settled = balanceOf([order()], [payment({ amountPesewas: fromCedis(450) })]);
    expect(balanceSentence(settled)).toMatch(/^Settled/);
    expect(balanceSentence(settled).toLowerCase()).not.toContain('owes');

    const owing = balanceOf([order()], []);
    expect(balanceSentence(owing)).toMatch(/^Owes GHS 450\.00/);
  });

  it('says plainly when there is nothing either way', () => {
    expect(balanceSentence(balanceOf([], []))).toBe('Nothing confirmed and nothing received.');
  });

  it('adds up only live payments', () => {
    expect(
      formatGHS(
        receivedTotal([
          payment({ id: 'a', amountPesewas: fromCedis(100) }),
          payment({ id: 'b', amountPesewas: fromCedis(50) }),
          payment({ id: 'c', amountPesewas: fromCedis(999), reversedAt: TODAY }),
        ]),
      ),
    ).toBe('GHS 150.00');
    expect(isLive(payment())).toBe(true);
    expect(isLive(payment({ reversedAt: TODAY }))).toBe(false);
  });
});

describe('what cannot be recorded at all', () => {
  const base = {
    amountPesewas: fromCedis(200) as Pesewas | null,
    method: 'MOMO',
    receivedOn: TODAY,
    today: TODAY,
    reference: 'MP260929.1432.A12345',
    receivedBy: null as string | null,
  };

  it('accepts an ordinary payment', () => {
    expect(paymentErrors(base)).toEqual([]);
  });

  it('refuses an amount that is not an amount', () => {
    expect(paymentErrors({ ...base, amountPesewas: null })[0]).toMatch(/how much/i);
  });

  /**
   * A REFUND IS ITS OWN ACT. Recording it as a negative payment makes every
   * total on every screen quietly wrong.
   */
  it('REFUSES A NEGATIVE PAYMENT, AND SAYS WHAT TO DO INSTEAD', () => {
    const problems = paymentErrors({ ...base, amountPesewas: fromCedis(-50) });
    expect(problems[0]).toMatch(/more than nothing/i);
    expect(problems[0]).toMatch(/reverse the payment/i);
  });

  it('refuses money that arrives tomorrow', () => {
    expect(
      paymentErrors({ ...base, receivedOn: new Date(TODAY.getTime() + DAY) })[0],
    ).toMatch(/cannot arrive in the future/i);
  });

  it('but accepts one recorded a few days late', () => {
    expect(paymentErrors({ ...base, receivedOn: new Date(TODAY.getTime() - 3 * DAY) })).toEqual([]);
  });

  it('refuses a method nobody chose', () => {
    expect(paymentErrors({ ...base, method: '' })[0]).toMatch(/how did the money arrive/i);
  });
});

describe('what makes somebody look twice, without stopping them', () => {
  const owing = balanceOf([order()], []); // owes GHS 450

  it('an ordinary payment raises nothing', () => {
    expect(
      paymentWarnings({
        amountPesewas: fromCedis(200),
        method: 'MOMO',
        reference: 'MP260929.1432.A12345',
        receivedBy: null,
        balance: owing,
      }),
    ).toEqual([]);
  });

  it('A MOMO PAYMENT WITH NO REFERENCE CANNOT BE MATCHED LATER', () => {
    const warnings = paymentWarnings({
      amountPesewas: fromCedis(200),
      method: 'MOMO',
      reference: '   ',
      receivedBy: null,
      balance: owing,
    });
    expect(warnings[0].field).toBe('reference');
    expect(warnings[0].message).toMatch(/against the statement later/i);
  });

  it('AND CASH WITH NOBODY NAMED LEAVES NO RECORD AT ALL', () => {
    const warnings = paymentWarnings({
      amountPesewas: fromCedis(200),
      method: 'CASH',
      reference: null,
      receivedBy: null,
      balance: owing,
    });
    expect(warnings.some((w) => w.field === 'receivedBy')).toBe(true);
    // Cash is not warned about for a missing reference — there is never one.
    expect(warnings.some((w) => w.field === 'reference')).toBe(false);
  });

  it('paying more than is owed warns and still saves', () => {
    const warnings = paymentWarnings({
      amountPesewas: fromCedis(600),
      method: 'MOMO',
      reference: 'X',
      receivedBy: null,
      balance: owing,
    });
    expect(warnings[0].message).toMatch(/GHS 150\.00 more than they owe/);
    expect(warnings[0].message).toMatch(/in credit/i);
  });

  it('and paying when nothing is owed says it is money ahead', () => {
    const settled = balanceOf([order()], [payment({ amountPesewas: fromCedis(450) })]);
    const warnings = paymentWarnings({
      amountPesewas: fromCedis(100),
      method: 'MOMO',
      reference: 'X',
      receivedBy: null,
      balance: settled,
    });
    expect(warnings[0].message).toMatch(/paid ahead of an order/i);
  });
});

describe('reversing a payment', () => {
  it('NEEDS A REASON — money nobody can account for is worse than a wrong figure', () => {
    expect(reversalErrors({ alreadyReversed: false, reason: '' })[0]).toMatch(/say why/i);
    expect(reversalErrors({ alreadyReversed: false, reason: 'Entered twice' })).toEqual([]);
  });

  it('cannot happen twice', () => {
    expect(reversalErrors({ alreadyReversed: true, reason: 'Again' })[0]).toMatch(
      /already been reversed/i,
    );
  });
});

describe('reading a list of payments', () => {
  it('most recent first', () => {
    const older = payment({ id: 'a', receivedOn: new Date(TODAY.getTime() - DAY) });
    const newer = payment({ id: 'b', receivedOn: TODAY });
    expect(sortPayments([older, newer]).map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('summarises what stands, and says how many were reversed', () => {
    const summary = paymentSummary([
      payment({ id: 'a', amountPesewas: fromCedis(200) }),
      payment({ id: 'b', amountPesewas: fromCedis(100), reversedAt: TODAY }),
    ]);
    expect(summary).toContain('GHS 200.00');
    expect(summary).toContain('1 payment');
    expect(summary).toContain('1 reversed');
  });

  it('says so plainly when nothing has come in', () => {
    expect(paymentSummary([])).toBe('Nothing received yet.');
  });

  it('and distinguishes that from everything having been reversed', () => {
    expect(paymentSummary([payment({ reversedAt: TODAY })])).toMatch(
      /every payment recorded here was reversed/i,
    );
  });
});
