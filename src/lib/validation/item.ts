import { z } from 'zod';
import type { Dimension } from '@/lib/uom';

/**
 * Item and stock-location validation — ADRAH Farms
 *
 * An "item" is anything the farm holds a quantity of: feed, vaccine, disinfectant,
 * crates, diesel. It is deliberately NOT poultry-specific — a cattle unit added
 * later records mineral licks and dewormer through exactly this model.
 */

export const ITEM_CATEGORIES = [
  'FEED',
  'VACCINE',
  'MEDICINE',
  'DISINFECTANT',
  'PACKAGING',
  'FUEL',
  'PPE',
  'EQUIPMENT',
  'SPARE_PART',
  'FINISHED_PRODUCT',
  'OTHER',
] as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/**
 * How each category behaves, as data.
 *
 * `suggestedUnits` narrows the unit picker to what that category is actually
 * bought in — it does NOT restrict it. A storekeeper who buys feed in tonnes
 * knows something the software does not, and a picker that refuses is a picker
 * that gets worked around by choosing the nearest wrong option.
 *
 * `perishableByDefault` only sets the checkbox's starting state. Whether a batch
 * carries an expiry date is a fact about the product, not a rule the system
 * should insist on.
 */
export const CATEGORY_META: Record<
  ItemCategory,
  { label: string; hint: string; suggestedUnits: string[]; perishableByDefault: boolean }
> = {
  FEED: {
    label: 'Feed',
    hint: 'Chick mash, grower, layer mash, concentrates.',
    suggestedUnits: ['bag_50kg', 'bag_25kg', 'kg', 'tonne'],
    perishableByDefault: true,
  },
  VACCINE: {
    label: 'Vaccine',
    hint: 'Counted in doses. Cold chain and expiry matter.',
    suggestedUnits: ['dose', 'vial_1000', 'vial_500'],
    perishableByDefault: true,
  },
  MEDICINE: {
    label: 'Medicine',
    hint: 'Antibiotics, vitamins, coccidiostats.',
    suggestedUnits: ['ml', 'litre', 'g', 'kg'],
    perishableByDefault: true,
  },
  DISINFECTANT: {
    label: 'Disinfectant',
    hint: 'Footbath, house and equipment disinfection.',
    suggestedUnits: ['litre', 'ml', 'kg'],
    perishableByDefault: false,
  },
  PACKAGING: {
    label: 'Packaging',
    hint: 'Egg crates, trays, sacks, labels.',
    suggestedUnits: ['piece', 'crate'],
    perishableByDefault: false,
  },
  FUEL: {
    label: 'Fuel',
    hint: 'Diesel, petrol, LPG for brooding.',
    suggestedUnits: ['litre', 'kg'],
    perishableByDefault: false,
  },
  PPE: {
    label: 'Protective clothing',
    hint: 'Overalls, boots, gloves, masks.',
    suggestedUnits: ['piece'],
    perishableByDefault: false,
  },
  EQUIPMENT: {
    label: 'Equipment',
    hint: 'Feeders, drinkers, brooders, thermometers.',
    suggestedUnits: ['piece'],
    perishableByDefault: false,
  },
  SPARE_PART: {
    label: 'Spare part',
    hint: 'Bulbs, valves, belts, fittings.',
    suggestedUnits: ['piece'],
    perishableByDefault: false,
  },
  FINISHED_PRODUCT: {
    label: 'Finished product',
    hint: 'Eggs and birds held for sale.',
    suggestedUnits: ['crate', 'piece', 'bird', 'box'],
    perishableByDefault: true,
  },
  OTHER: {
    label: 'Other',
    hint: 'Anything else the farm holds a quantity of.',
    suggestedUnits: ['piece', 'kg', 'litre'],
    perishableByDefault: false,
  },
};

/** Short prefix used when a SKU is derived rather than typed. */
const CATEGORY_PREFIX: Record<ItemCategory, string> = {
  FEED: 'FD',
  VACCINE: 'VX',
  MEDICINE: 'MD',
  DISINFECTANT: 'DS',
  PACKAGING: 'PK',
  FUEL: 'FU',
  PPE: 'PP',
  EQUIPMENT: 'EQ',
  SPARE_PART: 'SP',
  FINISHED_PRODUCT: 'FP',
  OTHER: 'GN',
};

/**
 * Turn a name into a usable SKU.
 *
 * Storekeepers should not have to invent codes. A derived SKU is offered, and
 * can be overwritten by a farm that already has its own numbering — which is
 * common, because the supplier's code is often what appears on the invoice.
 *
 * Pure and exported so it can be tested without a browser or a database.
 */
export function deriveSku(name: string, category: ItemCategory): string {
  const full = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  let body = full.slice(0, 16);

  // Cut back to a word boundary rather than through one. "VX-NEWCASTLE-LA-SOT"
  // is a code nobody will read aloud correctly; "VX-NEWCASTLE-LA" is.
  if (body.length < full.length && !full.startsWith(`${body}-`)) {
    const lastBreak = body.lastIndexOf('-');
    if (lastBreak >= 2) body = body.slice(0, lastBreak);
  }
  body = body.replace(/-+$/g, '');

  return body ? `${CATEGORY_PREFIX[category]}-${body}` : CATEGORY_PREFIX[category];
}

const sku = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'At least 2 characters.')
  .max(24, 'At most 24 characters.')
  .regex(/^[A-Z0-9-]+$/, 'Letters, numbers and hyphens only.');

/**
 * A threshold quantity, ENTERED in the item's stock unit.
 *
 * Blank means "no threshold", which is not zero — an item with a reorder level
 * of 0 would alert only once it ran out, which is exactly too late. This is the
 * same trap the daily record hit, and it is handled the same way: read the
 * string first, then decide what emptiness means.
 */
const threshold = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : Number(v)))
  .refine(
    (v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 10_000_000),
    'Enter a quantity, or leave it blank for no alert.',
  );

/** An HTML checkbox posts "on" when ticked and nothing at all when not. */
const checkbox = z
  .string()
  .optional()
  .transform((v) => v === 'on' || v === 'true');

export const itemSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter a name.').max(80),
    category: z.enum(ITEM_CATEGORIES, { message: 'Choose a category.' }),
    /** Blank is allowed — the action derives one from the name. */
    sku: z
      .union([sku, z.literal('')])
      .optional()
      .transform((v) => (v === '' || v === undefined ? null : v)),
    /** The unit KEY, not a database id — forms stay free of primary keys. */
    stockUomKey: z.string().trim().min(1, 'Choose a unit.'),
    reorderLevel: threshold,
    minimumStock: threshold,
    isPerishable: checkbox,
  })
  .refine(
    (v) => v.minimumStock === null || v.reorderLevel === null || v.reorderLevel >= v.minimumStock,
    {
      path: ['reorderLevel'],
      message: 'The reorder level should be at or above the minimum, not below it.',
    },
  );

export type ItemInput = z.infer<typeof itemSchema>;

export const stockLocationSchema = z.object({
  siteId: z.string().trim().min(1, 'Choose a farm.'),
  name: z.string().trim().min(2, 'Enter a name.').max(60),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'At least 2 characters.')
    .max(12, 'At most 12 characters.')
    .regex(/^[A-Z0-9-]+$/, 'Letters, numbers and hyphens only.'),
});

export type StockLocationInput = z.infer<typeof stockLocationSchema>;

/**
 * Whether an item's unit may be swapped for another.
 *
 * Within a dimension this is only a display preference: stock is stored in the
 * base unit either way, so moving feed from "bag (50 kg)" to "kg" changes
 * nothing about the numbers already recorded.
 *
 * ACROSS dimensions it is destructive. An item that has been receiving kilograms
 * and is switched to litres leaves every historical movement meaning something
 * it no longer says, and no migration can recover the intent. So once a single
 * movement exists, the dimension is fixed.
 */
export function unitChangeAllowed(
  from: Dimension,
  to: Dimension,
  movementCount: number,
): { allowed: true } | { allowed: false; reason: string } {
  if (from === to || movementCount === 0) return { allowed: true };
  return {
    allowed: false,
    reason:
      `This item already has ${movementCount} recorded movement(s) measured in ${from}. ` +
      `Changing it to ${to} would make that history mean something it never said. ` +
      `Create a new item instead.`,
  };
}
