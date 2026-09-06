import { z } from 'zod';
import { GHANA_REGIONS } from '@/lib/ghana';
import { ITEM_CATEGORIES } from '@/lib/validation/item';

/**
 * Procurement validation — ADRAH Farms
 *
 * Contact details are kept as typed. A supplier form filled in while somebody
 * is on the phone is not the place to reject a number for its punctuation —
 * src/lib/ghana.ts recovers a dialable form when it can, and the screen simply
 * offers no WhatsApp link when it cannot.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

export const supplierSchema = z.object({
  name: z.string().trim().min(2, 'Enter the supplier’s name.').max(80),
  /** Blank is fine — the action derives one from the name. */
  code: optionalText(20),
  contactName: optionalText(80),
  phone: optionalText(24),
  altPhone: optionalText(24),
  email: optionalText(120),
  town: optionalText(80),
  district: optionalText(80),
  region: z
    .enum(GHANA_REGIONS)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /**
   * How long this supplier takes. Blank means "use the farm's own figure" —
   * a real answer, not an unfinished form.
   */
  leadTimeDays: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : Number(v)))
    .refine(
      (v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 365),
      'Enter a whole number of days, or leave it blank to use the farm’s figure.',
    ),
  paymentTerms: optionalText(120),
  notes: optionalText(500),
});

export type SupplierInput = z.infer<typeof supplierSchema>;

/** Which categories a supplier sells. Checkboxes, so read with getAll. */
export function parseSupplies(formData: FormData): string[] {
  const valid = new Set<string>(ITEM_CATEGORIES);
  return formData
    .getAll('supplies')
    .map((v) => String(v))
    .filter((v) => valid.has(v));
}

/**
 * A short code from the name, so paperwork has something to quote.
 *
 * Derived rather than typed for the same reason a grade key is: a code people
 * edit is a code that eventually differs from the one on last year's invoice.
 */
export function supplierCodeFrom(name: string): string {
  return (
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20) || 'SUPPLIER'
  );
}

// ---------------------------------------------------------------------------
// PURCHASE ORDERS
// ---------------------------------------------------------------------------

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'That date is not valid.');

const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

/**
 * The header of an order.
 *
 * `expectedOn` MAY BE BLANK and MAY BE IN THE FUTURE — the future is the normal
 * case. It is deliberately not defaulted from the supplier's lead time here:
 * the form offers that date as a suggestion somebody can accept or change, and
 * a schema that filled it in silently would turn an average into a promise.
 */
export const orderHeaderSchema = z.object({
  siteId: z.string().trim().min(1, 'Choose where the goods are going.'),
  supplierId: z.string().trim().min(1, 'Choose a supplier.'),
  orderedOn: isoDate.refine(
    (d) => d.getTime() <= todayUtc().getTime(),
    'An order cannot be placed on a future date.',
  ),
  expectedOn: z
    .union([isoDate, z.literal('')])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : (v as Date))),
  notes: optionalText(500),
});

export type OrderHeaderInput = z.infer<typeof orderHeaderSchema>;

/**
 * One line, added on its own.
 *
 * Lines are added ONE AT A TIME rather than as a grid of rows. A grid is a
 * desktop idea; the person building a feed order is holding a phone in a store,
 * and a five-column table at 390px wide is where mistyped quantities come from.
 * It also means each line is saved the moment it is entered, so a dropped
 * connection costs one line rather than the whole order.
 */
export const orderLineSchema = z.object({
  itemId: z.string().trim().min(1, 'Choose an item.'),
  quantityOrdered: z
    .string()
    .trim()
    .min(1, 'Enter how many.')
    .transform((v) => Number(v))
    .refine(
      (v) => Number.isFinite(v) && v > 0 && v <= 10_000_000,
      'Enter a quantity greater than zero.',
    ),
  /** The unit KEY as ordered — bags, not kilograms. Forms carry no primary keys. */
  orderUomKey: z.string().trim().min(1, 'Choose a unit.'),
  /**
   * Agreed price per ordered unit, in cedis. BLANK MEANS NOT AGREED, which is
   * an ordinary state for an order placed by phone — not an unfinished form.
   */
  unitPriceCedis: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : Number(v)))
    .refine(
      (v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 100_000_000),
      'Enter a price in cedis, or leave it blank if none was agreed.',
    ),
  notes: optionalText(200),
});

export type OrderLineInput = z.infer<typeof orderLineSchema>;

/** Cancelling. The reason is required — see PurchaseOrder.cancelReason. */
export const cancelOrderSchema = z.object({
  cancelReason: z
    .string()
    .trim()
    .min(3, 'Say why it was cancelled. In three months this is the only explanation there is.')
    .max(200),
});

/**
 * A delivery recorded AGAINST an order line.
 *
 * Distinct from `receiptSchema` in validation/receipt.ts, which handles a
 * delivery nobody ordered through the system — a bag bought at the market on
 * the way home. That path stays: not every delivery has an order behind it, and
 * forcing one would mean either fake orders or unrecorded stock.
 *
 * What this one adds is the LINE it is being matched against. Everything else
 * about how the stock enters the ledger is identical, and deliberately so.
 */
export const orderReceiptSchema = z.object({
  lineId: z.string().trim().min(1, 'Choose what arrived.'),
  stockLocationId: z.string().trim().min(1, 'Choose a store.'),
  /** How much arrived, IN THE UNIT THE LINE WAS ORDERED IN. */
  quantity: z
    .string()
    .trim()
    .min(1, 'Enter how much arrived.')
    .transform((v) => Number(v))
    .refine(
      (v) => Number.isFinite(v) && v > 0 && v <= 10_000_000,
      'Enter a quantity greater than zero.',
    ),
  occurredOn: isoDate.refine(
    (d) => d.getTime() <= todayUtc().getTime(),
    'A delivery cannot be recorded for a future date.',
  ),
  batchNumber: optionalText(40),
  /** May be in the future — that is the normal case — or in the past. */
  expiresOn: z
    .union([isoDate, z.literal('')])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : (v as Date))),
  /**
   * What was actually invoiced, per ordered unit, in cedis.
   *
   * THIS IS THE PRICE THAT ENTERS STOCK, not the one on the order. The order
   * is what the farm expected to pay; the delivery note is what it did pay, and
   * a stock valuation built on the expectation would be wrong by exactly the
   * amount worth knowing about.
   */
  priceCedis: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : Number(v)))
    .refine(
      (v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 100_000_000),
      'Enter a price in cedis, or leave it blank if the invoice has not arrived.',
    ),
  /** Waybill or invoice number. */
  reference: optionalText(120),
  notes: optionalText(500),
  /** The fingerprint of the warnings the person was actually shown. */
  acknowledgedToken: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
});

export type OrderReceiptInput = z.infer<typeof orderReceiptSchema>;
