/**
 * Terminology — ADRAH Farms
 *
 * The words a screen uses for the core entities, resolved from
 * `SpeciesProfile.terminology` rather than typed into each page.
 *
 * WHY THIS EXISTS AT ALL, AND WHY IT ARRIVES NOW
 *   Nothing in the core is named Flock, House or Egg — that rule has held in the
 *   schema since Milestone 0. It has not held in the UI, where a dozen screens
 *   say "Flock" in plain text. That was survivable while every screen was about
 *   birds. Egg production is the milestone that would have hard-coded "Egg" into
 *   another dozen files, at which point the species framework becomes a comment
 *   in the schema rather than a fact about the software.
 *
 *   So the words come from the species profile, which is data. A farm that adds
 *   pigs gets "Herd", "Pen" and "Piglets" without a single screen being edited.
 *
 * THE DEFAULTS ARE DELIBERATELY GENERIC, NOT POULTRY.
 *   If a species profile has no terminology map, screens read "Group", "Unit"
 *   and "Output" — awkward on purpose. A poultry-shaped default would let a
 *   missing map go unnoticed for months and would quietly reintroduce exactly
 *   the assumption this module exists to remove.
 */

export interface Terminology {
  /** One animal: "Bird", "Pig", "Cow". */
  animal: string;
  animalPlural: string;
  /** The group it belongs to: "Flock", "Herd", "Batch". */
  animalGroup: string;
  animalGroupPlural: string;
  /** Where it lives: "House", "Pen", "Paddock", "Pond". */
  productionUnit: string;
  productionUnitPlural: string;
  /** What it produces, as a plural: "Eggs", "Milk", "Piglets". */
  production: string;
  /** One unit of that produce: "Egg", "Litre", "Piglet". */
  productionSingular: string;
}

export const DEFAULT_TERMINOLOGY: Terminology = {
  animal: 'Animal',
  animalPlural: 'Animals',
  animalGroup: 'Group',
  animalGroupPlural: 'Groups',
  productionUnit: 'Unit',
  productionUnitPlural: 'Units',
  production: 'Output',
  productionSingular: 'Output',
};

/**
 * Read the words out of a species profile's `terminology` JSON.
 *
 * The seeded map holds four singular-ish keys — animal, animalGroup,
 * productionUnit, production. Plurals and the singular of the produce are
 * DERIVED unless the map states them, because English farm nouns pluralise by
 * adding an "s" and demanding eight keys where four will do is how a
 * configuration screen ends up half filled in.
 *
 * A species whose words do not follow the rule supplies them explicitly:
 * `animalPlural`, `animalGroupPlural`, `productionUnitPlural` and
 * `productionSingular` are all read when present.
 */
export function terminologyFrom(raw: unknown): Terminology {
  if (!raw || typeof raw !== 'object') return DEFAULT_TERMINOLOGY;
  const map = raw as Record<string, unknown>;

  const word = (key: string, fallback: string): string => {
    const value = map[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
  };

  const animal = word('animal', DEFAULT_TERMINOLOGY.animal);
  const animalGroup = word('animalGroup', DEFAULT_TERMINOLOGY.animalGroup);
  const productionUnit = word('productionUnit', DEFAULT_TERMINOLOGY.productionUnit);
  const production = word('production', DEFAULT_TERMINOLOGY.production);

  return {
    animal,
    animalPlural: word('animalPlural', plural(animal)),
    animalGroup,
    animalGroupPlural: word('animalGroupPlural', plural(animalGroup)),
    productionUnit,
    productionUnitPlural: word('productionUnitPlural', plural(productionUnit)),
    production,
    productionSingular: word('productionSingular', singular(production)),
  };
}

/**
 * Add an "s" unless the word already ends in one.
 *
 * Good enough for Bird, Flock, House, Pen, Herd, Pond and Paddock. "Milk" comes
 * back as "Milks", which is wrong — and is exactly why the explicit keys exist.
 */
function plural(word: string): string {
  return word.endsWith('s') || word.endsWith('S') ? word : `${word}s`;
}

/** Drop a trailing "s". "Eggs" → "Egg"; "Milk" is left alone. */
function singular(word: string): string {
  return word.length > 1 && word.endsWith('s') ? word.slice(0, -1) : word;
}

/**
 * The same word mid-sentence.
 *
 * Headings are title case ("Eggs collected"); a sentence is not ("no eggs were
 * collected"). One helper rather than a `.toLowerCase()` at every call site, so
 * the whole system lower-cases the same way and in the same locale.
 */
export function lower(word: string): string {
  return word.toLocaleLowerCase('en-GH');
}
