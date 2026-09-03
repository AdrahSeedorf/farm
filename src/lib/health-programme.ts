import type { Warning } from '@/lib/warnings';

/**
 * Reading a health programme someone else wrote — ADRAH Farms
 *
 * A vet or hatchery hands over a table. This turns it into rows the system can
 * schedule from, and says clearly what it could not read rather than guessing.
 *
 * IT CONTAINS NO SCHEDULE OF ITS OWN. Every age, dose and withdrawal period in
 * the output came from the text that was pasted in. The checks below look for
 * signs of a TRANSCRIPTION mistake — a duplicated row, an age in the wrong unit,
 * a medication with no withdrawal recorded — and never for whether the schedule
 * is clinically sound, which is not a judgement software gets to make.
 */

export const ROUTES = [
  'DRINKING_WATER',
  'EYE_DROP',
  'NASAL_DROP',
  'SPRAY',
  'WING_WEB',
  'INJECTION_SUBCUTANEOUS',
  'INJECTION_INTRAMUSCULAR',
  'IN_FEED',
  'TOPICAL',
  'ORAL',
  'OTHER',
] as const;

export type Route = (typeof ROUTES)[number];

export const ROUTE_LABELS: Record<Route, string> = {
  DRINKING_WATER: 'Drinking water',
  EYE_DROP: 'Eye drop',
  NASAL_DROP: 'Nasal drop',
  SPRAY: 'Spray',
  WING_WEB: 'Wing web',
  INJECTION_SUBCUTANEOUS: 'Injection (subcutaneous)',
  INJECTION_INTRAMUSCULAR: 'Injection (intramuscular)',
  IN_FEED: 'In feed',
  TOPICAL: 'Topical',
  ORAL: 'Oral',
  OTHER: 'Other',
};

/**
 * How a written route maps to the stored one.
 *
 * Deliberately generous about spelling, because the source is a person's table:
 * "eye drop", "Eye-drop", "OCULAR" and "eyedrop" are all the same instruction,
 * and rejecting three of them means the row gets dropped or, worse, retyped.
 */
const ROUTE_ALIASES: Record<string, Route> = {
  water: 'DRINKING_WATER',
  drinkingwater: 'DRINKING_WATER',
  drinking: 'DRINKING_WATER',
  dw: 'DRINKING_WATER',
  eyedrop: 'EYE_DROP',
  eye: 'EYE_DROP',
  ocular: 'EYE_DROP',
  intraocular: 'EYE_DROP',
  nasaldrop: 'NASAL_DROP',
  nasal: 'NASAL_DROP',
  intranasal: 'NASAL_DROP',
  spray: 'SPRAY',
  coarsespray: 'SPRAY',
  aerosol: 'SPRAY',
  wingweb: 'WING_WEB',
  wingstab: 'WING_WEB',
  ww: 'WING_WEB',
  subcutaneous: 'INJECTION_SUBCUTANEOUS',
  sc: 'INJECTION_SUBCUTANEOUS',
  sq: 'INJECTION_SUBCUTANEOUS',
  intramuscular: 'INJECTION_INTRAMUSCULAR',
  im: 'INJECTION_INTRAMUSCULAR',
  injection: 'INJECTION_INTRAMUSCULAR',
  feed: 'IN_FEED',
  infeed: 'IN_FEED',
  topical: 'TOPICAL',
  oral: 'ORAL',
  mouth: 'ORAL',
};

export function parseRoute(raw: string): Route | null {
  const key = raw.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!key) return null;
  if ((ROUTES as readonly string[]).includes(raw.trim().toUpperCase())) {
    return raw.trim().toUpperCase() as Route;
  }
  return ROUTE_ALIASES[key] ?? null;
}

export const EVENT_TYPES = [
  'VACCINATION',
  'MEDICATION',
  'SUPPLEMENT',
  'TREATMENT',
  'OTHER',
] as const;
export type ProgrammeEventType = (typeof EVENT_TYPES)[number];

export interface ParsedProgrammeItem {
  ageDays: number;
  name: string;
  eventType: ProgrammeEventType;
  route: Route | null;
  dosePerBird: number | null;
  eggWithdrawalDays: number | null;
  meatWithdrawalDays: number | null;
  windowDays: number;
  notes: string | null;
  sortOrder: number;
}

export interface ParsedProgramme {
  rows: ParsedProgrammeItem[];
  warnings: Warning[];
  errors: string[];
}

const HEADERS = {
  age: ['agedays', 'age', 'days', 'day'],
  week: ['week', 'weeks', 'ageweeks', 'wk'],
  name: ['name', 'vaccine', 'what', 'disease', 'product', 'intervention'],
  type: ['type', 'eventtype', 'kind'],
  route: ['route', 'method', 'administration', 'via', 'how'],
  dose: ['dose', 'doseperbird', 'dosage', 'perbird'],
  eggWithdrawal: ['eggwithdrawal', 'eggwithdrawaldays', 'eggwd', 'eggs'],
  meatWithdrawal: ['meatwithdrawal', 'meatwithdrawaldays', 'meatwd', 'meat'],
  window: ['window', 'windowdays', 'tolerance'],
  notes: ['notes', 'note', 'comment', 'remarks'],
};

const normalise = (h: string) => h.trim().toLowerCase().replace(/[\s_()\-./]/g, '');

function findColumn(header: string[], aliases: string[]): number {
  return header.findIndex((h) => aliases.includes(h));
}

/** Blank means NOT STATED, which is never the same as zero. */
function optionalNumber(cell: string | undefined): number | null {
  const raw = (cell ?? '').trim();
  if (raw === '' || raw === '-' || raw === '—') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Read a programme table.
 *
 * Accepts commas, tabs or semicolons, and an age column in DAYS or WEEKS —
 * vets write both, and demanding one means the farm does forty conversions by
 * hand, which is forty chances to be a week out.
 */
export function parseProgrammeTable(input: string): ParsedProgramme {
  const errors: string[] = [];
  const warnings: Warning[] = [];

  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length < 2) {
    return {
      rows: [],
      warnings,
      errors: ['Need a header row and at least one row of entries.'],
    };
  }

  const header = lines[0].split(/[,\t;]/).map(normalise);
  const ageIndex = findColumn(header, HEADERS.age);
  const weekIndex = findColumn(header, HEADERS.week);
  const nameIndex = findColumn(header, HEADERS.name);

  if (ageIndex === -1 && weekIndex === -1) {
    errors.push('No age column found. Use a header of "ageDays" or "week".');
  }
  if (nameIndex === -1) {
    errors.push('No name column found. Use a header of "name" or "vaccine".');
  }
  if (errors.length > 0) return { rows: [], warnings, errors };

  const useWeeks = ageIndex === -1;
  const ageCol = useWeeks ? weekIndex : ageIndex;
  if (useWeeks) {
    warnings.push({
      field: 'age',
      message: 'Reading the age column as WEEKS and converting to days.',
    });
  }

  const cols = {
    type: findColumn(header, HEADERS.type),
    route: findColumn(header, HEADERS.route),
    dose: findColumn(header, HEADERS.dose),
    egg: findColumn(header, HEADERS.eggWithdrawal),
    meat: findColumn(header, HEADERS.meatWithdrawal),
    window: findColumn(header, HEADERS.window),
    notes: findColumn(header, HEADERS.notes),
  };

  const rows: ParsedProgrammeItem[] = [];

  lines.slice(1).forEach((line, offset) => {
    const cells = line.split(/[,\t;]/);
    const lineNumber = offset + 2;

    const rawAge = Number((cells[ageCol] ?? '').trim());
    const name = (cells[nameIndex] ?? '').trim();

    if (!Number.isFinite(rawAge) || rawAge < 0) {
      errors.push(`Line ${lineNumber}: "${cells[ageCol] ?? ''}" is not an age.`);
      return;
    }
    if (name === '') {
      errors.push(`Line ${lineNumber}: no name — what is being given?`);
      return;
    }

    const rawRoute = cols.route === -1 ? '' : (cells[cols.route] ?? '');
    const route = rawRoute.trim() === '' ? null : parseRoute(rawRoute);
    if (rawRoute.trim() !== '' && route === null) {
      warnings.push({
        field: `route:${lineNumber}`,
        message: `Line ${lineNumber}: could not read the route "${rawRoute.trim()}" — recorded as Other.`,
      });
    }

    const rawType = cols.type === -1 ? '' : (cells[cols.type] ?? '').trim().toUpperCase();
    const eventType = (EVENT_TYPES as readonly string[]).includes(rawType)
      ? (rawType as ProgrammeEventType)
      : 'VACCINATION';

    rows.push({
      ageDays: useWeeks ? Math.round(rawAge * 7) : Math.round(rawAge),
      name,
      eventType,
      route: rawRoute.trim() === '' ? null : (route ?? 'OTHER'),
      dosePerBird: cols.dose === -1 ? null : optionalNumber(cells[cols.dose]),
      eggWithdrawalDays: cols.egg === -1 ? null : optionalNumber(cells[cols.egg]),
      meatWithdrawalDays: cols.meat === -1 ? null : optionalNumber(cells[cols.meat]),
      windowDays: cols.window === -1 ? 2 : (optionalNumber(cells[cols.window]) ?? 2),
      notes:
        cols.notes === -1 ? null : ((cells[cols.notes] ?? '').trim() || null),
      sortOrder: 0,
    });
  });

  rows.sort((a, b) => a.ageDays - b.ageDays);
  rows.forEach((r, i) => {
    r.sortOrder = i;
  });

  warnings.push(...checkProgramme(rows));

  return { rows, warnings, errors };
}

/**
 * Look for signs the table was TRANSCRIBED wrongly.
 *
 * Explicitly NOT a clinical review. Nothing here knows whether a programme is
 * appropriate, only whether it looks like something went astray between the
 * vet's paper and this screen.
 */
export function checkProgramme(rows: ParsedProgrammeItem[]): Warning[] {
  const warnings: Warning[] = [];
  if (rows.length === 0) return warnings;

  const seen = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.ageDays}|${r.name.toLowerCase()}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 1) {
      const [age, name] = key.split('|');
      warnings.push({
        field: 'duplicate',
        message: `"${name}" appears ${count} times on day ${age}. Check whether a row was pasted twice.`,
      });
    }
  }

  // An age column read in the wrong unit is the mistake this catches: a
  // programme that finishes on day 18 is almost certainly eighteen WEEKS.
  const last = rows[rows.length - 1];
  if (last.ageDays <= 30 && rows.length >= 4) {
    warnings.push({
      field: 'age',
      message: `The whole programme finishes by day ${last.ageDays}. If those figures were weeks, the ages are seven times too small — check the column heading.`,
    });
  }

  if (last.ageDays > 700) {
    warnings.push({
      field: 'age',
      message: `The last entry is at day ${last.ageDays}, which is past two years of age. Check that row.`,
    });
  }

  const medicationsWithoutWithdrawal = rows.filter(
    (r) =>
      (r.eventType === 'MEDICATION' || r.eventType === 'TREATMENT') &&
      r.eggWithdrawalDays === null &&
      r.meatWithdrawalDays === null,
  );
  if (medicationsWithoutWithdrawal.length > 0) {
    warnings.push({
      field: 'withdrawal',
      message:
        `${medicationsWithoutWithdrawal.length} medication or treatment entr` +
        `${medicationsWithoutWithdrawal.length === 1 ? 'y has' : 'ies have'} no withdrawal period recorded ` +
        `(${medicationsWithoutWithdrawal.map((r) => r.name).join(', ')}). ` +
        `Blank means nobody wrote one down, not that none applies — the label will say.`,
    });
  }

  return warnings;
}

/**
 * What to say about a programme that has not been signed off.
 *
 * Shown wherever the programme is used, not hidden on a settings page. Someone
 * following a schedule at six in the morning should be able to see, there and
 * then, whether a vet has looked at it.
 */
export function approvalNote(programme: {
  status: 'DRAFT' | 'APPROVED';
  approvedByName: string | null;
  approvedByRole: string | null;
  approvedOn: Date | null;
  sourceName: string | null;
}): string {
  if (programme.status === 'APPROVED' && programme.approvedByName) {
    const role = programme.approvedByRole ? `, ${programme.approvedByRole}` : '';
    const on = programme.approvedOn
      ? ` on ${programme.approvedOn.toISOString().slice(0, 10)}`
      : '';
    return `Approved by ${programme.approvedByName}${role}${on}.`;
  }

  const from = programme.sourceName ? ` It came from ${programme.sourceName}.` : '';
  return `Provisional — no veterinarian has reviewed this yet.${from} It can still be used; the reminders work either way.`;
}
