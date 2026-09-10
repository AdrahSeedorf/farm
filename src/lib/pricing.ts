import { type Pesewas, formatGHS, multiply, add, ZERO } from '@/lib/money';

/**
 * Products and prices — ADRAH Farms
 *
 * What the farm sells and what it charges. Pure; no database.
 *
 * A PRICE IS AN APPEND-ONLY RECORD, NEVER AN EDITABLE FIELD.
 *
 *   The obvious design is a `price` column on the product that somebody updates
 *   when the price changes. It loses the only question a price list is ever
 *   really asked: "what were we charging in March?" — which is exactly what an
 *   order from March needs in order to still add up. A farm that raises its
 *   price in June and then cannot reprint a May invoice has a bookkeeping
 *   problem it cannot fix, because the number is simply gone.
 *
 *   So prices are dated rows. Changing a price adds one. Nothing is overwritten,
 *   the current price is derived, and every past order can always be explained.
 *   The same discipline as the population ledger and the stock ledger, applied
 *   to money.
 *
 * A CUSTOMER PRICE BEATS THE LIST PRICE.
 *   Wholesale is agreed per buyer — "GHS 45 a crate, held for the quarter" — and
 *   that agreement has to survive the list price moving. See `priceFor` for the
 *   exact rule, which is written out rather than left to a sort order.
 *
 * MONEY IS INTEGER PESEWAS EVERYWHERE. Never a float, never cedis, never a
 * string. The one place cedis appear is the moment a figure is shown or typed.
 */

// ---------------------------------------------------------------------------
// WHAT IS SOLD
// ---------------------------------------------------------------------------

export interface Product {
  id: string;
  /** What the farm calls it. "Crate of 30 — Large". */
  name: string;
  /** Stable key for imports and reports. */
  sku: string;
  /**
   * The grade this product is drawn from, where it is drawn from one.
   *
   * NULLABLE, because not everything the farm sells is graded produce — a spent
   * hen is a product with no grade behind it. Where it is set, it is what ties
   * a sale back to what was actually collected and sorted that morning.
   */
  gradeId: string | null;
  gradeName: string | null;
  /**
   * How many base units are in one of these.
   *
   * A crate of thirty eggs is `30`, in the grade's own base unit. This is what
   * lets the farm answer "how many eggs did we sell" from a list of crates
   * without anybody multiplying in their head.
   */
  unitsPerPack: number;
  /** What one of these is called when counted: "crate", "tray", "bird". */
  packLabel: string;
  isActive: boolean;
  notes: string | null;
}

/** "3 crates" / "1 crate". */
export function packQuantity(product: Product, quantity: number): string {
  return `${quantity} ${product.packLabel}${quantity === 1 ? '' : 's'}`;
}

/**
 * How many base units a quantity of packs comes to.
 *
 * SAID IN THE PACK AND ALSO IN THE THING ITSELF. "3 crates" is what somebody
 * orders; "90 eggs" is what has to leave the store, and the two being the same
 * fact expressed differently is exactly the kind of place this codebase has
 * already been bitten three times by unit confusion.
 */
export function baseUnits(product: Product, packs: number): number {
  return packs * product.unitsPerPack;
}

// ---------------------------------------------------------------------------
// WHAT IS CHARGED
// ---------------------------------------------------------------------------

export interface PriceRow {
  id: string;
  productId: string;
  /** Null means this is the list price — what anybody pays. */
  customerId: string | null;
  /**
   * Price per pack, in pesewas.
   *
   * NULL MEANS THE AGREEMENT ENDED. A customer row with no price says "from this
   * date, this buyer goes back to the list price" — which is a thing that
   * happens and which there would otherwise be no way to record. Deleting the
   * old agreement instead would erase what they were charged last quarter,
   * which is the whole point of keeping prices as rows.
   */
  pricePesewas: Pesewas | null;
  effectiveFrom: Date;
  note: string | null;
  setByName: string | null;
  createdAt: Date;
}

export interface ResolvedPrice {
  pricePesewas: Pesewas;
  /** True when this came from an agreement with this buyer. */
  isCustomerPrice: boolean;
  effectiveFrom: Date;
  note: string | null;
  setByName: string | null;
}

/**
 * What this buyer pays for this product on this day.
 *
 * THE RULE, IN FULL:
 *
 *   1. Consider only rows for this product whose `effectiveFrom` is on or
 *      before the day in question. A price agreed to start next Monday is not
 *      today's price.
 *   2. Among the rows agreed WITH THIS BUYER, take the newest. If it carries a
 *      price, that is the answer.
 *   3. If it carries no price — the agreement was ended — or there are no buyer
 *      rows at all, fall back to the newest LIST row and take its price.
 *   4. If there is no list price either, there is no answer. Null, not zero.
 *      A product nobody has priced must not quietly sell for nothing.
 *
 * Step 3 is the one worth reading twice: an ENDED agreement falls through to the
 * list price rather than leaving the buyer with no price at all.
 *
 * Ties on the same date are broken by which row was entered last, because two
 * prices dated the same day means somebody corrected themselves.
 */
export function priceFor(
  rows: PriceRow[],
  input: { productId: string; customerId: string | null; on: Date },
): ResolvedPrice | null {
  const day = input.on.getTime();

  const applicable = rows
    .filter((r) => r.productId === input.productId && r.effectiveFrom.getTime() <= day)
    .sort((a, b) => {
      const byDate = b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
      if (byDate !== 0) return byDate;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

  if (input.customerId) {
    const mine = applicable.find((r) => r.customerId === input.customerId);
    if (mine && mine.pricePesewas !== null) {
      return {
        pricePesewas: mine.pricePesewas,
        isCustomerPrice: true,
        effectiveFrom: mine.effectiveFrom,
        note: mine.note,
        setByName: mine.setByName,
      };
    }
    // A row with no price means the agreement ended — fall through to the list.
  }

  const list = applicable.find((r) => r.customerId === null);
  if (!list || list.pricePesewas === null) return null;

  return {
    pricePesewas: list.pricePesewas,
    isCustomerPrice: false,
    effectiveFrom: list.effectiveFrom,
    note: list.note,
    setByName: list.setByName,
  };
}

/**
 * The price that will apply, and when — for a row dated in the future.
 *
 * Shown next to the current price so a change agreed last week is visible before
 * the day it takes effect, rather than surprising whoever is quoting.
 */
export function nextPrice(
  rows: PriceRow[],
  input: { productId: string; customerId: string | null; on: Date },
): PriceRow | null {
  const day = input.on.getTime();
  return (
    rows
      .filter(
        (r) =>
          r.productId === input.productId &&
          r.effectiveFrom.getTime() > day &&
          (r.customerId === input.customerId || r.customerId === null),
      )
      .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime())[0] ?? null
  );
}

/** A sentence saying where a price came from, for whoever is about to quote it. */
export function priceBasisSentence(price: ResolvedPrice | null): string {
  if (!price) {
    return 'No price set. Nothing can be quoted for this until somebody sets one.';
  }
  const from = price.effectiveFrom.toISOString().slice(0, 10);
  const who = price.setByName ? ` by ${price.setByName}` : '';
  if (price.isCustomerPrice) {
    return `Agreed with this buyer${who} from ${from}.${price.note ? ` ${price.note}` : ''}`;
  }
  return `List price${who} from ${from}.${price.note ? ` ${price.note}` : ''}`;
}

// ---------------------------------------------------------------------------
// ARITHMETIC
// ---------------------------------------------------------------------------

export interface Line {
  quantity: number;
  unitPricePesewas: Pesewas;
}

/** quantity × unit price. Integer pesewas throughout. */
export function lineTotal(line: Line): Pesewas {
  return multiply(line.unitPricePesewas, line.quantity);
}

export function linesTotal(lines: Line[]): Pesewas {
  return lines.length === 0 ? ZERO : add(...lines.map(lineTotal));
}

/**
 * What a quantity of a product comes to, at whatever price applies.
 *
 * Returns null rather than zero where there is no price. A quote of GHS 0.00 is
 * a quote somebody might act on.
 */
export function quote(
  product: Product,
  price: ResolvedPrice | null,
  quantity: number,
): { total: Pesewas; sentence: string } | null {
  if (!price || quantity <= 0) return null;
  const total = multiply(price.pricePesewas, quantity);
  return {
    total,
    sentence: `${packQuantity(product, quantity)} at ${formatGHS(price.pricePesewas)} = ${formatGHS(total)}`,
  };
}

// ---------------------------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------------------------

export function productErrors(input: {
  name: string;
  sku: string;
  unitsPerPack: number;
  packLabel: string;
}): string[] {
  const problems: string[] = [];

  if (input.name.trim().length < 2) problems.push('Give the product a name.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/.test(input.sku.trim())) {
    problems.push('The code should be letters, numbers, dots or dashes — no spaces.');
  }
  if (input.packLabel.trim().length < 2) {
    problems.push('What is one of these called? "crate", "tray", "bird".');
  }
  if (!Number.isInteger(input.unitsPerPack) || input.unitsPerPack < 1) {
    problems.push('How many go in one? A whole number, at least one.');
  }
  // A CRATE OF 100,000 EGGS IS A TYPO, and it would multiply every figure built
  // on it. The bound is deliberately loose enough never to argue with a real
  // pack size.
  if (input.unitsPerPack > 10_000) {
    problems.push('That is a very large pack. Check the figure.');
  }

  return problems;
}

/**
 * A price of zero is allowed ONLY with a note saying why.
 *
 * Refusing it outright would be wrong — a farm does give a crate away, to settle
 * a complaint or to get a shop to try the product, and a system that cannot
 * record that forces somebody to either not record the sale at all or to invent
 * a price and then a matching discount. Both are worse than a zero with a
 * reason on it.
 *
 * But an unexplained zero is almost always a slipped keystroke, and it is the
 * one typo that costs the farm the whole line rather than part of it. So the
 * note is the price of the exception.
 */
export function priceErrors(
  input: { pricePesewas: Pesewas | null; effectiveFrom: Date | null; note?: string | null },
  asOf: Date = new Date(),
): string[] {
  const problems: string[] = [];

  if (!input.effectiveFrom || Number.isNaN(input.effectiveFrom.getTime())) {
    problems.push('From when does this price apply?');
  } else {
    // BACKDATING IS ALLOWED, and deliberately so: a price agreed on the phone
    // last Tuesday and typed in today should be recorded as Tuesday's, or the
    // orders from that week will not reconcile. What is refused is a date so old
    // it is plainly a typo.
    const twoYears = asOf.getTime() - 730 * 86_400_000;
    if (input.effectiveFrom.getTime() < twoYears) {
      problems.push('That date is more than two years back. Check it.');
    }
  }

  if (input.pricePesewas !== null) {
    if (!Number.isInteger(input.pricePesewas) || input.pricePesewas < 0) {
      problems.push('A price cannot be negative.');
    }
    if (input.pricePesewas === 0 && (input.note ?? '').trim().length < 3) {
      problems.push(
        'A price of zero means this can be given away. If that is what you mean, say why in the note — otherwise check the figure.',
      );
    }
  }

  return problems;
}
