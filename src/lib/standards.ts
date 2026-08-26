/**
 * Breed standard parsing — ADRAH Farms
 *
 * Turns the body-weight table out of a breed's management guide into the
 * age-in-days → grams map that `rearing.ts` compares samples against.
 *
 * WHY THIS IS A LOADER AND NOT A BUILT-IN TABLE
 *   Every breed publishes its own figures, they are revised between editions,
 *   and they differ enough to change a decision. Shipping a guessed curve would
 *   be worse than shipping none: it would be trusted, and a flock would be
 *   judged behind or on target against numbers nobody could source.
 */

export interface StandardRow {
  ageDays: number;
  grams: number;
}

export interface ParsedStandard {
  rows: StandardRow[];
  warnings: string[];
  errors: string[];
}

const HEADER_ALIASES = {
  age: ['agedays', 'age', 'days', 'day'],
  week: ['week', 'weeks', 'ageweeks', 'wk'],
  grams: ['grams', 'g', 'weight', 'weightg', 'bodyweight', 'bodyweightg'],
};

function normalise(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_()-]/g, '');
}

/**
 * Read a two-column table of ages and weights.
 *
 * Accepts commas or tabs, and either an age-in-days or an age-in-WEEKS column —
 * guides publish weekly, so demanding days would mean the farm doing arithmetic
 * by hand forty times, which is forty chances to make a mistake.
 */
export function parseStandardTable(input: string): ParsedStandard {
  const errors: string[] = [];
  const warnings: string[] = [];

  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length < 2) {
    return { rows: [], warnings, errors: ['Need a header row and at least one row of figures.'] };
  }

  const header = lines[0].split(/[,\t;]/).map(normalise);
  const ageIndex = header.findIndex((h) => HEADER_ALIASES.age.includes(h));
  const weekIndex = header.findIndex((h) => HEADER_ALIASES.week.includes(h));
  const gramsIndex = header.findIndex((h) => HEADER_ALIASES.grams.includes(h));

  if (ageIndex === -1 && weekIndex === -1) {
    errors.push('No age column found. Use a header of "ageDays" or "week".');
  }
  if (gramsIndex === -1) {
    errors.push('No weight column found. Use a header of "grams".');
  }
  if (errors.length > 0) return { rows: [], warnings, errors };

  const useWeeks = ageIndex === -1;
  const ageCol = useWeeks ? weekIndex : ageIndex;
  if (useWeeks) warnings.push('Reading the age column as WEEKS and converting to days.');

  const seen = new Map<number, number>();
  lines.slice(1).forEach((line, offset) => {
    const cells = line.split(/[,\t;]/);
    const rawAge = Number(cells[ageCol]?.trim());
    const rawGrams = Number(cells[gramsIndex]?.trim());
    const lineNumber = offset + 2;

    if (!Number.isFinite(rawAge) || rawAge < 0) {
      errors.push(`Line ${lineNumber}: "${cells[ageCol] ?? ''}" is not an age.`);
      return;
    }
    if (!Number.isFinite(rawGrams) || rawGrams <= 0) {
      errors.push(`Line ${lineNumber}: "${cells[gramsIndex] ?? ''}" is not a weight in grams.`);
      return;
    }

    const ageDays = useWeeks ? Math.round(rawAge * 7) : Math.round(rawAge);
    const grams = Math.round(rawGrams);

    if (seen.has(ageDays)) {
      warnings.push(`Day ${ageDays} appears more than once — keeping the later figure.`);
    }
    seen.set(ageDays, grams);
  });

  const rows = [...seen.entries()]
    .map(([ageDays, grams]) => ({ ageDays, grams }))
    .sort((a, b) => a.ageDays - b.ageDays);

  // A pullet does not lose weight. A drop almost always means a mistyped digit
  // or a column read in the wrong order.
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].grams < rows[i - 1].grams) {
      warnings.push(
        `Weight falls from ${rows[i - 1].grams} g at day ${rows[i - 1].ageDays} to ${rows[i].grams} g at day ${rows[i].ageDays}. Check that row.`,
      );
    }
  }

  if (rows.length > 0 && rows[0].ageDays > 7) {
    warnings.push(
      `The table starts at day ${rows[0].ageDays}. Samples taken before that will show no target.`,
    );
  }

  return { rows, warnings, errors };
}

/** Shape it for storage in `ProductionTypeProfile.standards.bodyWeightByAgeDays`. */
export function toStandardMap(rows: StandardRow[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [String(r.ageDays), r.grams]));
}
