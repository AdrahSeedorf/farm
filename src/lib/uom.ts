/**
 * Units of measure — ADRAH Farms
 *
 * RULE: quantities are STORED in the base unit of their dimension and
 * DISPLAYED in whatever unit the user thinks in.
 *
 * The failure this prevents: a storekeeper records "180" meaning bags, a
 * manager reads it as kilograms, and the feed reorder happens three weeks late.
 * Every quantity in this system travels with its unit or it does not travel.
 */

export type Dimension = 'COUNT' | 'MASS' | 'VOLUME';

export interface Uom {
  key: string;
  name: string;
  symbol: string;
  dimension: Dimension;
  /** Multiply a quantity in this unit by this factor to reach the base unit. */
  factorToBase: number;
  isBase?: boolean;
}

/** Base unit per dimension: COUNT -> piece, MASS -> kg, VOLUME -> litre. */
export const BASE_UNIT: Record<Dimension, string> = {
  COUNT: 'piece',
  MASS: 'kg',
  VOLUME: 'litre',
};

/**
 * Seed units. This is DATA, mirrored into the UnitOfMeasure table — the farm can
 * add its own (a 25 kg bag, a 12-egg pack) without a code change.
 *
 * A crate of eggs is 30 in Ghana. This is the number the whole egg business is
 * counted in, so it is deliberately explicit rather than assumed.
 */
export const SEED_UNITS: readonly Uom[] = [
  { key: 'piece', name: 'Piece', symbol: 'pc', dimension: 'COUNT', factorToBase: 1, isBase: true },
  { key: 'dozen', name: 'Dozen', symbol: 'dz', dimension: 'COUNT', factorToBase: 12 },
  { key: 'crate', name: 'Crate (30 eggs)', symbol: 'crate', dimension: 'COUNT', factorToBase: 30 },
  { key: 'box', name: 'Box (12 crates)', symbol: 'box', dimension: 'COUNT', factorToBase: 360 },
  { key: 'bird', name: 'Bird', symbol: 'bird', dimension: 'COUNT', factorToBase: 1 },

  // Vaccines are bought by the vial and given by the dose, so both must exist.
  //
  // THERE IS DELIBERATELY NO UNIT CALLED SIMPLY "VIAL". A vial holds 500 doses
  // or 1,000 doses depending on the product, and a unit whose conversion factor
  // depends on which box you picked up is a unit that will eventually be wrong
  // by a factor of two. Each vial size names its own dose count, and a farm that
  // buys a 200-dose presentation adds that unit as data rather than guessing.
  { key: 'dose', name: 'Dose', symbol: 'dose', dimension: 'COUNT', factorToBase: 1 },
  { key: 'vial_500', name: 'Vial (500 doses)', symbol: 'vial-500', dimension: 'COUNT', factorToBase: 500 },
  { key: 'vial_1000', name: 'Vial (1,000 doses)', symbol: 'vial-1k', dimension: 'COUNT', factorToBase: 1000 },

  { key: 'kg', name: 'Kilogram', symbol: 'kg', dimension: 'MASS', factorToBase: 1, isBase: true },
  { key: 'g', name: 'Gram', symbol: 'g', dimension: 'MASS', factorToBase: 0.001 },
  { key: 'bag_50kg', name: 'Bag (50 kg)', symbol: 'bag', dimension: 'MASS', factorToBase: 50 },
  { key: 'bag_25kg', name: 'Bag (25 kg)', symbol: 'bag', dimension: 'MASS', factorToBase: 25 },
  { key: 'tonne', name: 'Tonne', symbol: 't', dimension: 'MASS', factorToBase: 1000 },

  { key: 'litre', name: 'Litre', symbol: 'L', dimension: 'VOLUME', factorToBase: 1, isBase: true },
  { key: 'ml', name: 'Millilitre', symbol: 'mL', dimension: 'VOLUME', factorToBase: 0.001 },
  { key: 'm3', name: 'Cubic metre', symbol: 'm³', dimension: 'VOLUME', factorToBase: 1000 },
] as const;

const BY_KEY = new Map(SEED_UNITS.map((u) => [u.key, u]));

export class UomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UomError';
  }
}

export function getUnit(key: string): Uom {
  const unit = BY_KEY.get(key);
  if (!unit) throw new UomError(`Unknown unit "${key}"`);
  return unit;
}

/** Convert a quantity in `unitKey` into the base unit of its dimension. */
export function toBase(quantity: number, unitKey: string): number {
  const unit = getUnit(unitKey);
  return quantity * unit.factorToBase;
}

/** Convert a base-unit quantity into `unitKey`. */
export function fromBase(baseQuantity: number, unitKey: string): number {
  const unit = getUnit(unitKey);
  return baseQuantity / unit.factorToBase;
}

/**
 * Convert between two units. THROWS across dimensions — there is no sane answer
 * to "how many kilograms is a crate", and silently guessing one is how bad data
 * enters a farm system.
 */
export function convert(quantity: number, fromKey: string, toKey: string): number {
  const from = getUnit(fromKey);
  const to = getUnit(toKey);
  if (from.dimension !== to.dimension) {
    throw new UomError(
      `Cannot convert ${from.dimension} (${from.key}) to ${to.dimension} (${to.key}). ` +
        `These measure different things.`,
    );
  }
  return (quantity * from.factorToBase) / to.factorToBase;
}

/**
 * Format for display, e.g. formatQuantity(1712, 'piece', 'crate')
 *   -> "57.1 crate"
 * Whole numbers print without decimals so "4 bags" does not become "4.0 bags".
 */
export function formatQuantity(
  baseQuantity: number,
  baseUnitKey: string,
  displayUnitKey: string = baseUnitKey,
  maxDecimals = 2,
): string {
  const value = convert(baseQuantity, baseUnitKey, displayUnitKey);
  const unit = getUnit(displayUnitKey);
  const rounded = Number(value.toFixed(maxDecimals));
  const text = new Intl.NumberFormat('en-GH', {
    maximumFractionDigits: maxDecimals,
  }).format(rounded);
  return `${text} ${unit.symbol}`;
}

/**
 * Split a count into whole containers plus a remainder — how eggs are actually
 * talked about: "57 crates and 2 eggs", not "57.07 crates".
 */
export function splitIntoContainers(
  pieces: number,
  containerKey: string,
): { containers: number; remainder: number } {
  const per = getUnit(containerKey).factorToBase;
  const containers = Math.floor(pieces / per);
  return { containers, remainder: pieces - containers * per };
}
