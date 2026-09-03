/**
 * Breed standard parsing — ADRAH Farms
 *
 * Turns the tables in a breed's management guide into the age-keyed maps that
 * `rearing.ts` and `production.ts` compare a flock against: body weight in
 * grams, and hen-day production as a percentage.
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

export interface LayCurveRow {
  ageDays: number;
  /** Hen-day production, as a percentage. */
  pct: number;
}

export interface ParsedStandard {
  rows: StandardRow[];
  warnings: string[];
  errors: string[];
}

export interface ParsedLayCurve {
  rows: LayCurveRow[];
  warnings: string[];
  errors: string[];
}

const AGE_ALIASES = ['agedays', 'age', 'days', 'day'];
const WEEK_ALIASES = ['week', 'weeks', 'ageweeks', 'wk'];

const GRAMS_ALIASES = ['grams', 'g', 'weight', 'weightg', 'bodyweight', 'bodyweightg'];

/**
 * What the percentage column can be called.
 *
 * Guides are inconsistent: ISA prints "% hen-day", Lohmann prints "laying rate",
 * Hy-Line prints "hen-day production". All three mean the same figure, and
 * demanding one spelling would mean somebody retyping forty rows by hand — which
 * is forty chances to introduce a typo into a target.
 */
const PCT_ALIASES = [
  'hendaypct',
  'henday',
  'hendayproduction',
  'hendayproductionpct',
  'lay',
  'laypct',
  'laying',
  'layingrate',
  'layrate',
  'rate',
  'production',
  'productionpct',
  'percent',
  // A column headed only "%" arrives here as "pct" — see normalise().
  'pct',
];

/**
 * A header reduced to letters and digits, so "Body Weight (g)", "body_weight_g"
 * and "bodyweightg" are one column rather than three.
 *
 * The percent sign goes with the punctuation — guides print "Lay %" and
 * "Production (%)" — but a column headed only "%" would then normalise to
 * nothing, so it becomes "pct" and matches on its own.
 */
function normalise(header: string): string {
  const stripped = header.trim().toLowerCase().replace(/[\s_()%-]/g, '');
  return stripped === '' && header.includes('%') ? 'pct' : stripped;
}

interface ColumnSpec {
  aliases: string[];
  /** Shown when the column is missing entirely. */
  missing: string;
  /** Shown when one cell cannot be read. */
  cell: (raw: string) => string;
  valid: (value: number) => boolean;
  round: (value: number) => number;
}

interface RawRow {
  ageDays: number;
  value: number;
}

/**
 * Read a two-column table of ages and one other figure.
 *
 * Accepts commas, tabs or semicolons, and either an age-in-days or an
 * age-in-WEEKS column — guides publish weekly, so demanding days would mean the
 * farm doing arithmetic by hand forty times.
 *
 * Shared by both parsers below. One implementation of "which column is the age
 * and how do I read it", because the day the two drifted, one loader would
 * accept a table the other rejected and nobody would know which was right.
 */
function readAgeTable(
  input: string,
  spec: ColumnSpec,
): { rows: RawRow[]; warnings: string[]; errors: string[] } {
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
  const ageIndex = header.findIndex((h) => AGE_ALIASES.includes(h));
  const weekIndex = header.findIndex((h) => WEEK_ALIASES.includes(h));
  const valueIndex = header.findIndex((h) => spec.aliases.includes(h));

  if (ageIndex === -1 && weekIndex === -1) {
    errors.push('No age column found. Use a header of "ageDays" or "week".');
  }
  if (valueIndex === -1) {
    errors.push(spec.missing);
  }
  if (errors.length > 0) return { rows: [], warnings, errors };

  const useWeeks = ageIndex === -1;
  const ageCol = useWeeks ? weekIndex : ageIndex;
  if (useWeeks) warnings.push('Reading the age column as WEEKS and converting to days.');

  const seen = new Map<number, number>();
  lines.slice(1).forEach((line, offset) => {
    const cells = line.split(/[,\t;]/);
    const rawAge = Number(cells[ageCol]?.trim());
    const rawValue = Number(cells[valueIndex]?.trim().replace('%', ''));
    const lineNumber = offset + 2;

    if (!Number.isFinite(rawAge) || rawAge < 0) {
      errors.push(`Line ${lineNumber}: "${cells[ageCol] ?? ''}" is not an age.`);
      return;
    }
    if (!Number.isFinite(rawValue) || !spec.valid(rawValue)) {
      errors.push(`Line ${lineNumber}: ${spec.cell(cells[valueIndex] ?? '')}`);
      return;
    }

    const ageDays = useWeeks ? Math.round(rawAge * 7) : Math.round(rawAge);

    if (seen.has(ageDays)) {
      warnings.push(`Day ${ageDays} appears more than once — keeping the later figure.`);
    }
    seen.set(ageDays, spec.round(rawValue));
  });

  const rows = [...seen.entries()]
    .map(([ageDays, value]) => ({ ageDays, value }))
    .sort((a, b) => a.ageDays - b.ageDays);

  return { rows, warnings, errors };
}

/** Read a table of ages and body weights in grams. */
export function parseStandardTable(input: string): ParsedStandard {
  const parsed = readAgeTable(input, {
    aliases: GRAMS_ALIASES,
    missing: 'No weight column found. Use a header of "grams".',
    cell: (raw) => `"${raw}" is not a weight in grams.`,
    valid: (v) => v > 0,
    round: Math.round,
  });

  const rows: StandardRow[] = parsed.rows.map((r) => ({ ageDays: r.ageDays, grams: r.value }));
  const warnings = [...parsed.warnings];

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

  return { rows, warnings, errors: parsed.errors };
}

/**
 * Read a table of ages and hen-day production percentages.
 *
 * NO FALLING-VALUE CHECK, deliberately — unlike the weight curve above. A lay
 * curve is supposed to fall: a flock climbs to peak by about week 28 and
 * declines for the rest of the cycle, and warning about that would fire on every
 * correct table there is.
 */
export function parseLayCurveTable(input: string): ParsedLayCurve {
  const parsed = readAgeTable(input, {
    aliases: PCT_ALIASES,
    missing: 'No production column found. Use a header of "henDayPct" or "lay".',
    cell: (raw) =>
      `"${raw}" is not a hen-day percentage. A hen lays at most one egg a day, so the figure is between 0 and 100.`,
    valid: (v) => v >= 0 && v <= 100,
    // One decimal, because that is how guides publish it and rounding 90.4 to 90
    // would quietly move every target.
    round: (v) => Math.round(v * 10) / 10,
  });

  const rows: LayCurveRow[] = parsed.rows.map((r) => ({ ageDays: r.ageDays, pct: r.value }));
  const warnings = [...parsed.warnings];

  // A table of 0.9 and 0.05 is a table of FRACTIONS, and loading it would make
  // every flock look a hundred times behind its own breed standard. Warned
  // rather than refused, because a genuine table of a flock's first days really
  // can be under 1%.
  if (rows.length > 2 && rows.every((r) => r.pct <= 1)) {
    warnings.push(
      'Every figure is 1 or less. This looks like a table of fractions (0.9) rather than ' +
        'percentages (90). Check the column before relying on the comparison.',
    );
  }

  return { rows, warnings, errors: parsed.errors };
}

/** Shape it for storage in `Breed.standards.bodyWeightByAgeDays`. */
export function toStandardMap(rows: StandardRow[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [String(r.ageDays), r.grams]));
}

/** Shape it for storage in `Breed.standards.henDayPctByAgeDays`. */
export function toLayCurveMap(rows: LayCurveRow[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [String(r.ageDays), r.pct]));
}

export type StandardKind = 'weight' | 'lay';

/**
 * Which table this is, read off its header.
 *
 * So the loader can be pointed at a file without being told what is in it — and
 * so it can say which it decided BEFORE writing anything, rather than silently
 * loading a lay curve into the weight column.
 */
export function detectKind(input: string): StandardKind | null {
  const first = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#'));
  if (!first) return null;

  const header = first.split(/[,\t;]/).map(normalise);
  if (header.some((h) => GRAMS_ALIASES.includes(h))) return 'weight';
  if (header.some((h) => PCT_ALIASES.includes(h))) return 'lay';
  return null;
}
