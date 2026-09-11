import { type Pesewas, formatGHS, multiply, add, ZERO } from '@/lib/money';
import { customerErrors } from '@/lib/customers';

/**
 * Counter sales — ADRAH Farms
 *
 * SOMEBODY DRIVES UP TO THE GATE AND BUYS TWO CRATES.
 *
 * Through the ordinary screens that is five pages: find or add the buyer, start
 * an order, add a line, confirm it, record a load. With a customer standing
 * there and a car engine running, five pages means the sale is not recorded at
 * all — and an unrecorded sale is a store that disagrees with its shelf, which
 * is the exact failure this whole system exists to prevent.
 *
 * THE ONE RULE THAT MATTERS HERE:
 *
 *   A COUNTER SALE PRODUCES ORDINARY ROWS. It is not a new kind of record, not a
 *   flag on an order, not a separate table. It writes the same confirmed
 *   SalesOrder and the same Dispatch that the slow path writes, so every report,
 *   every ledger and every buyer page reads it without knowing it was quick.
 *   The screen is fast; the data is boring. A "quick sale" record type would
 *   have to be special-cased in every query written from now until the farm
 *   closes, and one of those queries would eventually forget.
 *
 * The withdrawal gate, the stock movements and the price rules are the same code
 * as everywhere else, because a sale at the gate is not less regulated than a
 * sale on the phone.
 *
 * NOTHING HERE RECORDS MONEY. The buyer at the gate almost certainly pays cash,
 * and there is still nowhere to write that down — see the note in sales.ts. What
 * this records is what left and what was agreed.
 */

// ---------------------------------------------------------------------------
// WHO BOUGHT IT
// ---------------------------------------------------------------------------

export const BUYER_MODES = ['EXISTING', 'NEW', 'COUNTER'] as const;
export type BuyerMode = (typeof BUYER_MODES)[number];

/**
 * The name the standing anonymous buyer is created under.
 *
 * WHY A STANDING BUYER RATHER THAN A BLANK.
 *
 *   A stranger paying cash for one crate will not give a phone number, and the
 *   right response to that is not to refuse the sale — it is to record it
 *   somewhere honest. Every one of these lands on a single clearly-named row, so
 *   counter takings add up to a figure the farm can look at, and nobody is ever
 *   fooled into thinking there is a customer here to ring.
 *
 *   The alternative — a nullable customer on the order — would make every screen
 *   and every query handle "no buyer", forever, to serve one case. This way the
 *   oddity is one row of data instead of a branch in a hundred places.
 */
export const COUNTER_BUYER_NAME = 'Counter sale';
export const COUNTER_BUYER_NOTE =
  'Not a person. Cash sales at the gate to buyers who did not leave a number are recorded against this row so they add up somewhere honest. Do not try to ring it.';

export interface BuyerChoice {
  mode: BuyerMode;
  /** EXISTING only. */
  customerId?: string | null;
  /** NEW only. */
  name?: string | null;
  phone?: string | null;
}

export function buyerErrors(choice: BuyerChoice): string[] {
  if (choice.mode === 'EXISTING') {
    return choice.customerId?.trim() ? [] : ['Which buyer? Choose one, or write a new name.'];
  }
  if (choice.mode === 'NEW') {
    /**
     * THE SAME RULE THE BUYER FORM USES, not a stricter one.
     *
     * Task 15.1 decided a buyer is a name and a number written however the
     * person writes it. A gate is the worst possible place to be fussier than
     * that — and two definitions of "a valid buyer" would drift until the same
     * person could be added on one screen and refused on the other.
     */
    return customerErrors({ name: choice.name ?? '', phone: choice.phone ?? '' });
  }
  return [];
}

export function buyerSentence(choice: BuyerChoice): string {
  if (choice.mode === 'COUNTER') {
    return 'Recorded against Counter sale — nobody to ring, but the crates still come off the store.';
  }
  if (choice.mode === 'NEW') {
    return 'They will be added to the buyer list, so the next sale finds them by number.';
  }
  return '';
}

// ---------------------------------------------------------------------------
// WHAT THEY BOUGHT
// ---------------------------------------------------------------------------

export interface CounterLineInput {
  productId: string;
  /** Whole packs. */
  quantity: number;
  /** What was actually agreed at the gate, where it differs from the list. */
  pricePesewas: Pesewas | null;
}

export interface SellableProduct {
  id: string;
  name: string;
  packLabel: string;
  unitsPerPack: number;
  /** The resolved price for this buyer today, or null when there is none. */
  pricePesewas: Pesewas | null;
  /** Base units in the produce store, or null when it is not held as stock. */
  onHandBase: number | null;
}

/**
 * What stops a counter sale being recorded at all.
 *
 * SHORT ON PURPOSE, like every other entry point. Surprising quantities and thin
 * stock are WARNINGS handled by the dispatch layer this composes onto; the
 * things here are the ones that would write a row nobody can read afterwards.
 */
export function counterSaleErrors(input: {
  lines: CounterLineInput[];
  products: SellableProduct[];
}): string[] {
  const problems: string[] = [];
  const selling = input.lines.filter((l) => l.quantity > 0);

  if (selling.length === 0) {
    problems.push('Nothing is on this sale yet. Say how many of something they took.');
    return problems;
  }

  if (selling.some((l) => !Number.isInteger(l.quantity))) {
    problems.push('Whole packs only. If they took a part crate, sell them trays instead.');
  }

  if (selling.some((l) => l.quantity > 100_000)) {
    problems.push('That is a very large sale. Check the figure.');
  }

  for (const line of selling) {
    const product = input.products.find((p) => p.id === line.productId);
    if (!product) {
      problems.push('One of those products is not on the list.');
      continue;
    }
    const price = line.pricePesewas ?? product.pricePesewas;
    if (price === null) {
      problems.push(
        `${product.name} has no price, and nothing can be sold without one. Set a list price, or type what they paid.`,
      );
    } else if (price < 0) {
      problems.push('A price cannot be negative.');
    }
  }

  return problems;
}

/** What the sale comes to, at the prices that will actually be recorded. */
export function saleTotal(
  lines: CounterLineInput[],
  products: SellableProduct[],
): Pesewas {
  const amounts = lines
    .filter((l) => l.quantity > 0)
    .map((line) => {
      const product = products.find((p) => p.id === line.productId);
      const price = line.pricePesewas ?? product?.pricePesewas ?? ZERO;
      return multiply(price, line.quantity);
    });
  return amounts.length === 0 ? ZERO : add(...amounts);
}

export function saleBaseUnits(
  lines: CounterLineInput[],
  products: SellableProduct[],
): number {
  return lines
    .filter((l) => l.quantity > 0)
    .reduce((total, line) => {
      const product = products.find((p) => p.id === line.productId);
      return total + line.quantity * (product?.unitsPerPack ?? 1);
    }, 0);
}

/**
 * What to read back to the person at the gate before they hand over money.
 *
 * SAID IN BOTH THE PACK AND THE THING. "2 crates · 60 eggs · GHS 90.00" is
 * checkable by the buyer, who counted crates, and by the storekeeper, who is
 * about to watch sixty eggs leave.
 */
export function saleSentence(
  lines: CounterLineInput[],
  products: SellableProduct[],
): string {
  const selling = lines.filter((l) => l.quantity > 0);
  if (selling.length === 0) return 'Nothing on it yet.';

  const parts = selling.map((line) => {
    const product = products.find((p) => p.id === line.productId);
    const label = product?.packLabel ?? 'pack';
    return `${line.quantity} ${label}${line.quantity === 1 ? '' : 's'} of ${product?.name ?? 'something'}`;
  });

  return `${parts.join(', ')} · ${saleBaseUnits(lines, products)} in all · ${formatGHS(
    saleTotal(lines, products),
  )}`;
}

/**
 * A note written onto the order, so the slow screens explain themselves.
 *
 * Somebody opening this order next month sees a confirmed order that was
 * dispatched the same minute it was written, which looks odd until it says why.
 */
export function counterSaleNote(mode: BuyerMode): string {
  return mode === 'COUNTER'
    ? 'Sold at the gate for cash. No buyer details were taken.'
    : 'Sold at the gate.';
}
