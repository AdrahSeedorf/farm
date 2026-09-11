import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, canAccessSite } from '@/lib/scope';
import { toE164Ghana } from '@/lib/brand';
import { warningToken, type Warning } from '@/lib/warnings';
import { withdrawalGate } from '@/lib/sales';
import {
  createOrder,
  addLine,
  orderById,
  confirmOrder,
  cancelOrder,
  suggestedPrice,
  restrictedFlocks,
} from '@/lib/sales-service';
import { recordDispatch, availableStock } from '@/lib/dispatch-service';
import { allPrices } from '@/lib/product-service';
import { priceFor } from '@/lib/pricing';
import { dispatchWarnings } from '@/lib/dispatch';
import {
  buyerErrors,
  counterSaleErrors,
  counterSaleNote,
  COUNTER_BUYER_NAME,
  COUNTER_BUYER_NOTE,
  type BuyerChoice,
  type CounterLineInput,
  type SellableProduct,
} from '@/lib/counter-sale';
import type { Pesewas } from '@/lib/money';

/**
 * Counter sale service — ADRAH Farms
 *
 * ONE SUBMIT, FIVE ORDINARY WRITES.
 *
 * This composes the order and dispatch services rather than reaching past them
 * into the tables. That is the whole design: a sale at the gate produces the same
 * confirmed SalesOrder and the same Dispatch as a sale arranged on the phone, so
 * nothing downstream needs to know the difference. Copying the writes here to
 * make them faster would give the farm two sets of rules for what a sale is, and
 * they would disagree within a month.
 *
 * EVERYTHING IS CHECKED BEFORE ANYTHING IS WRITTEN.
 *
 *   The five writes are separate transactions — an order, its lines, its
 *   confirmation, then a load — and a refusal halfway through would leave a
 *   confirmed order for produce the buyer never received. So the withdrawal gate
 *   and the warnings run first, on the sale as described, and the writes only
 *   start once the answer is yes. If one still fails, the order is cancelled with
 *   the reason rather than left standing.
 *
 * AND NO MONEY IS RECORDED. The buyer at the gate is almost certainly paying
 * cash into somebody's hand, and there is still nowhere honest to write that
 * down. See the note at the top of sales.ts.
 */

export class CounterSaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CounterSaleError';
  }
}

export interface CounterSaleInput {
  siteId: string;
  buyer: BuyerChoice;
  lines: CounterLineInput[];
  /**
   * Which house the produce came from, where the farm has said.
   *
   * Null is ordinary — eggs are pooled. It is only asked for, and only required,
   * while a house is inside a withdrawal period. Same rule as an order.
   */
  drawnFromFlockId: string | null;
  takenBy: string | null;
  notes: string | null;
}

export type CounterSaleResult =
  | {
      status: 'sold';
      orderId: string;
      orderNumber: string;
      dispatchId: string;
      reference: string;
      customerId: string;
      shortfalls: { productName: string; shortfallBase: number }[];
    }
  | { status: 'needsConfirmation'; warnings: Warning[]; token: string }
  | { status: 'refused'; message: string; clearsOn: Date | null };

// ---------------------------------------------------------------------------
// WHAT CAN BE SOLD, AND AT WHAT
// ---------------------------------------------------------------------------

/**
 * The sell screen's whole world, read in one go.
 *
 * PRICES ARE RESOLVED FOR THE BUYER IF THERE IS ONE. A wholesale buyer standing
 * at the gate gets their agreed price without anybody having to remember it,
 * which is the difference between the farm's price list being real and being a
 * document nobody applies.
 */
export async function sellableProducts(
  principal: Principal,
  siteId: string,
  customerId: string | null,
): Promise<SellableProduct[]> {
  const products = await db.product.findMany({
    where: { ...orgFilter(principal), isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, packLabel: true, unitsPerPack: true },
  });
  if (products.length === 0) return [];

  const stock = await availableStock(
    principal,
    siteId,
    products.map((p) => p.id),
  );

  const priced = await Promise.all(
    products.map(async (product) => {
      const resolved = customerId
        ? await suggestedPrice(principal, { productId: product.id, customerId })
        : await suggestedPrice(principal, { productId: product.id, customerId: '' });
      return {
        ...product,
        pricePesewas: resolved?.pricePesewas ?? null,
        onHandBase: stock.find((s) => s.productId === product.id)?.onHandBase ?? null,
      };
    }),
  );

  return priced;
}

/**
 * Every buyer who has an agreed price today, and what it is.
 *
 * WHY THE SCREEN NEEDS THIS ALL AT ONCE.
 *
 *   The price shown at the gate is the figure somebody reads out loud before
 *   taking money, so it has to change the instant a wholesale buyer is chosen —
 *   not after a round trip, and certainly not only once the sale is submitted.
 *   The server resolves the price again when it writes, so this is a display
 *   convenience and never the authority.
 *
 *   Only rows that actually exist are sent, so a farm with three agreements
 *   sends three numbers. A farm with hundreds would want this narrowed to the
 *   chosen buyer, and the shape below makes that a filter rather than a rewrite.
 */
export async function agreedPriceMap(
  principal: Principal,
  on: Date = new Date(),
): Promise<Record<string, Record<string, number>>> {
  const rows = await allPrices(principal);
  const map: Record<string, Record<string, number>> = {};

  const customerIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean) as string[])];
  const productIds = [...new Set(rows.map((r) => r.productId))];

  for (const customerId of customerIds) {
    for (const productId of productIds) {
      const resolved = priceFor(rows, { productId, customerId, on });
      // Only what DIFFERS from the list price is worth sending — a buyer on the
      // list price needs no entry, and sending one would be a second copy of a
      // figure that is already on the page.
      const list = priceFor(rows, { productId, customerId: null, on });
      if (resolved && resolved.isCustomerPrice && resolved.pricePesewas !== list?.pricePesewas) {
        map[customerId] ??= {};
        map[customerId][productId] = resolved.pricePesewas;
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// WHO IT WAS SOLD TO
// ---------------------------------------------------------------------------

/**
 * The standing row cash sales are recorded against.
 *
 * FOUND OR CREATED, NEVER DUPLICATED. It carries a note saying what it is,
 * because a row called "Counter sale" sitting in a list of real buyers with no
 * explanation is the kind of thing somebody eventually rings.
 */
async function counterBuyer(principal: Principal): Promise<{ id: string; name: string }> {
  const existing = await db.customer.findFirst({
    where: { ...orgFilter(principal), isCounterSale: true },
    select: { id: true, name: true },
  });
  if (existing) return existing;

  return db.customer.create({
    data: {
      organisationId: principal.organisationId,
      kind: 'RETAIL',
      name: COUNTER_BUYER_NAME,
      // No number, because there is nobody to ring. Kept as an empty string
      // rather than null so every screen that formats a phone still works.
      phone: '',
      notes: COUNTER_BUYER_NOTE,
      isCounterSale: true,
      createdById: principal.userId,
    },
    select: { id: true, name: true },
  });
}

async function resolveBuyer(
  principal: Principal,
  choice: BuyerChoice,
): Promise<{ id: string; name: string }> {
  if (choice.mode === 'COUNTER') return counterBuyer(principal);

  if (choice.mode === 'EXISTING') {
    const customer = await db.customer.findFirst({
      where: { id: choice.customerId ?? '', ...orgFilter(principal), archivedAt: null },
      select: { id: true, name: true },
    });
    if (!customer) throw new CounterSaleError('That buyer is not on the list.');
    return customer;
  }

  /**
   * A NEW BUYER IS CREATED WITHOUT THE DUPLICATE CONVERSATION.
   *
   * The buyer form warns when a number is already on the list and offers to open
   * the other row — right there, and impossible at a gate with a car running. So
   * this looks the number up first and REUSES the buyer if it finds one, which
   * is what the person would have chosen anyway. Two rows for one number is a
   * cost the slow path can afford to discuss; the fast path cannot.
   */
  const typed = (choice.phone ?? '').trim();
  const wanted = toE164Ghana(typed) ?? typed;
  const rows = await db.customer.findMany({
    where: { ...orgFilter(principal), archivedAt: null, isCounterSale: false },
    select: { id: true, name: true, phone: true },
  });
  const digits = (v: string) => v.replace(/\D/g, '').slice(-9);
  const match = rows.find((r) => digits(r.phone) === digits(wanted) && digits(wanted).length >= 6);
  if (match) return { id: match.id, name: match.name };

  const created = await db.customer.create({
    data: {
      organisationId: principal.organisationId,
      kind: 'RETAIL',
      name: (choice.name ?? '').trim(),
      phone: wanted,
      notes: 'Added at the gate during a sale.',
      createdById: principal.userId,
    },
    select: { id: true, name: true },
  });
  return created;
}

// ---------------------------------------------------------------------------
// THE SALE
// ---------------------------------------------------------------------------

export async function sellAtCounter(
  principal: Principal,
  input: CounterSaleInput,
  acknowledgedToken: string | null = null,
  today: Date = new Date(),
): Promise<CounterSaleResult> {
  if (!canAccessSite(principal, input.siteId)) {
    return refuse('That farm is not one you have access to.');
  }

  const buyerProblems = buyerErrors(input.buyer);
  if (buyerProblems.length > 0) return refuse(buyerProblems[0]);

  const selling = input.lines.filter((l) => l.quantity > 0);

  // Prices are resolved against the CHOSEN buyer, so an agreed price applies
  // even though nobody typed it. Read before the buyer row exists for a new
  // buyer — a brand-new buyer has no agreed price by definition, so the list
  // price is the right answer and reading it early costs nothing.
  const products = await sellableProducts(
    principal,
    input.siteId,
    input.buyer.mode === 'EXISTING' ? (input.buyer.customerId ?? null) : null,
  );

  const problems = counterSaleErrors({ lines: selling, products });
  if (problems.length > 0) return refuse(problems[0]);

  /**
   * THE WITHDRAWAL GATE, BEFORE ANYTHING IS WRITTEN.
   *
   * Run on the sale as described rather than on a saved order, because a refusal
   * after the order exists would leave a confirmed promise for produce that must
   * not be sold. While a house is restricted, a gate sale of pooled eggs cannot
   * proceed until somebody says which house — and at a gate that is often
   * unanswerable, which is the honest consequence of the promise the farm makes
   * publicly, not a gap in the software.
   */
  const restricted = await restrictedFlocks(principal, today);
  const verdict = withdrawalGate({
    restricted,
    drawnFromFlockId: input.drawnFromFlockId,
    hasProduceLines: selling.length > 0,
  });
  if (verdict.kind !== 'CLEAR') {
    const blocked = restricted.find((r) => r.flockId === input.drawnFromFlockId);
    return refuse(verdict.message, blocked?.clearsOn ?? restricted[0]?.clearsOn ?? null);
  }

  /**
   * The warnings, also before anything is written.
   *
   * `progress` is synthesised from the sale itself — nothing has gone out yet, so
   * ordered equals outstanding. That makes the "more than was ordered" warning
   * structurally impossible here, which is right: at a gate what they take IS
   * what they ordered. What survives is the one that matters — the store being
   * shorter than the load.
   */
  const warnings = dispatchWarnings({
    lines: selling.map((l) => ({
      salesOrderLineId: null,
      productId: l.productId,
      quantity: l.quantity,
      unitsPerPack: products.find((p) => p.id === l.productId)?.unitsPerPack ?? 1,
    })),
    progress: [],
    stock: products.map((p) => ({
      productId: p.id,
      productName: p.name,
      onHandBase: p.onHandBase,
    })),
    method: 'COLLECTED',
    receivedBy: null,
  })
    // The "was not on the order" warning is noise here — at a gate there is no
    // order for it to be off. Dropped by field rather than by message so a
    // reworded warning does not silently start appearing.
    .filter((w) => !w.message.startsWith('This was not on the order'));

  if (warnings.length > 0) {
    const token = warningToken(warnings);
    if (acknowledgedToken !== token) {
      return { status: 'needsConfirmation', warnings, token };
    }
  }

  // --- from here it writes --------------------------------------------------
  const buyer = await resolveBuyer(principal, input.buyer);

  const order = await createOrder(principal, {
    customerId: buyer.id,
    siteId: input.siteId,
    wantedOn: null,
    notes: [counterSaleNote(input.buyer.mode), input.notes].filter(Boolean).join(' '),
  });

  try {
    for (const line of selling) {
      await addLine(principal, order.id, {
        productId: line.productId,
        quantity: line.quantity,
        // A typed price is passed through as typed and recorded as MANUAL; a
        // blank one lets addLine resolve it, so the basis says LIST or AGREED
        // exactly as it would on a phone order.
        pricePesewas: line.pricePesewas as Pesewas | null,
        note: null,
      });
    }

    if (input.drawnFromFlockId) {
      await db.salesOrder.update({
        where: { id: order.id },
        data: { drawnFromFlockId: input.drawnFromFlockId },
      });
    }

    await confirmOrder(principal, order.id, today);

    // The load is every line on the order — at a gate what they take IS what
    // they ordered — so it is read back from the order rather than reassembled
    // from the form, which is one fewer place for the two to disagree.
    const saved = await orderById(principal, order.id);
    if (!saved) throw new CounterSaleError('That sale could not be read back.');

    const dispatch = await recordDispatch(
      principal,
      {
        salesOrderId: order.id,
        method: 'COLLECTED',
        dispatchedOn: startOfDay(today),
        takenBy: input.takenBy?.trim() || buyer.name,
        vehicle: null,
        receivedBy: null,
        notes: null,
        lines: saved.lines.map((l) => ({
          salesOrderLineId: l.id,
          productId: l.productId,
          quantity: l.quantity,
          unitsPerPack: l.unitsPerPack,
        })),
      },
      // The same warnings were shown and agreed above, before anything was
      // written. See RecordDispatchOptions — this says the person has seen them,
      // not that the checks are off.
      { warningsAlreadyAgreed: true },
      today,
    );

    if (dispatch.status !== 'recorded') {
      throw new CounterSaleError(
        dispatch.status === 'refused'
          ? dispatch.message
          : 'The load could not be recorded against this sale.',
      );
    }

    return {
      status: 'sold',
      orderId: order.id,
      orderNumber: order.orderNumber,
      dispatchId: dispatch.id,
      reference: dispatch.reference,
      customerId: buyer.id,
      shortfalls: dispatch.shortfalls,
    };
  } catch (error) {
    /**
     * NOTHING IS LEFT STANDING.
     *
     * A confirmed order with no load is a promise the farm did not keep and does
     * not know about. Cancelling keeps the row — it is still what somebody
     * attempted — with a reason that says what actually happened.
     */
    await cancelOrder(
      principal,
      order.id,
      'A counter sale that could not be completed. Nothing went out.',
    ).catch(() => undefined);
    if (error instanceof CounterSaleError) return refuse(error.message);
    throw error;
  }
}

function refuse(message: string, clearsOn: Date | null = null): CounterSaleResult {
  return { status: 'refused', message, clearsOn };
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
