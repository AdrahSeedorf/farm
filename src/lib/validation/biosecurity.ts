import { z } from 'zod';

/**
 * Biosecurity validation — ADRAH Farms
 *
 * The visitor form is filled in at a gate, on a phone, often by someone holding
 * something else. Everything except a name and a kind is optional, and the
 * blanks are recorded as blanks rather than as zeroes or as noes — "nobody
 * recorded whether they used the footbath" and "they did not use the footbath"
 * are different facts and the log has to keep them apart.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

/** A datetime-local value, e.g. "2026-09-04T08:30". */
const optionalDateTime = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === '') return null;
    const parsed = new Date(v.length === 16 ? `${v}:00.000Z` : v);
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Use the date and time picker.' });
      return z.NEVER;
    }
    return parsed;
  });

const requiredDateTime = z
  .string()
  .trim()
  .min(1, 'When did they arrive?')
  .transform((v, ctx) => {
    const parsed = new Date(v.length === 16 ? `${v}:00.000Z` : v);
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Use the date and time picker.' });
      return z.NEVER;
    }
    return parsed;
  });

/**
 * A three-state answer submitted as a string.
 *
 * "yes" / "no" / "" — and the blank is kept as null rather than coerced to
 * false. A footbath nobody recorded is not a footbath that went unused, and an
 * inspection reading this log next year needs to see the difference.
 */
const tristate = z
  .enum(['yes', 'no', ''])
  .optional()
  .transform((v) => (v === 'yes' ? true : v === 'no' ? false : null));

export const VISITOR_KINDS = [
  'VETERINARIAN',
  'SUPPLIER',
  'BUYER',
  'CONTRACTOR',
  'INSPECTOR',
  'STAFF_RETURNING',
  'NEIGHBOUR',
  'OTHER',
] as const;

export type VisitorKind = (typeof VISITOR_KINDS)[number];

export const VISITOR_KIND_LABELS: Record<VisitorKind, string> = {
  VETERINARIAN: 'Veterinarian',
  SUPPLIER: 'Supplier or delivery',
  BUYER: 'Buyer or trader',
  CONTRACTOR: 'Contractor',
  INSPECTOR: 'Inspector or official',
  STAFF_RETURNING: 'Staff returning from elsewhere',
  NEIGHBOUR: 'Neighbour',
  OTHER: 'Other',
};

export const CONTACT_DECLARATIONS = ['NOT_DECLARED', 'NONE', 'AT'] as const;
export type ContactDeclarationKind = (typeof CONTACT_DECLARATIONS)[number];

export const DECLARATION_LABELS: Record<ContactDeclarationKind, string> = {
  NONE: 'They have not been near other poultry',
  AT: 'They gave a date and time',
  NOT_DECLARED: 'Not asked, or they did not say',
};

export const visitorSchema = z
  .object({
    siteId: z.string().trim().min(1, 'Choose a farm.'),
    name: z.string().trim().min(2, 'Enter their name.').max(80),
    organisation: optionalText(80),
    /**
     * Left as typed. Ghanaian numbers arrive as "024 123 4567", "+233241234567"
     * and everything between; normalising them here would reject a real number
     * at a gate, which is the last place to argue about formatting.
     */
    phone: optionalText(24),
    kind: z.enum(VISITOR_KINDS, { message: 'What kind of visit was it?' }),
    purpose: optionalText(120),
    arrivedAt: requiredDateTime,
    declaration: z.enum(CONTACT_DECLARATIONS),
    lastPoultryContactAt: optionalDateTime,
    vehicleRegistration: optionalText(20),
    enteredProductionUnit: z.enum(['yes', 'no']).transform((v) => v === 'yes'),
    usedFootbath: tristate,
    woreFarmClothing: tristate,
    notes: optionalText(500),
  })
  .refine((v) => v.declaration !== 'AT' || v.lastPoultryContactAt !== null, {
    path: ['lastPoultryContactAt'],
    message: 'Give the date and time, or change the answer above.',
  })
  .refine(
    (v) =>
      v.lastPoultryContactAt === null || v.lastPoultryContactAt <= v.arrivedAt,
    {
      path: ['lastPoultryContactAt'],
      message: 'That is after they arrived here.',
    },
  );

export type VisitorInput = z.infer<typeof visitorSchema>;

export const departureSchema = z.object({
  departedAt: requiredDateTime,
});

/** Hours a visitor should be clear of other poultry. Blank means no rule. */
export const downtimeSchema = z.object({
  visitorDowntimeHours: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : Number(v)))
    .refine(
      (v) => v === null || (Number.isInteger(v) && v > 0 && v <= 336),
      'Enter a whole number of hours, up to two weeks — or leave it blank for no rule.',
    ),
});

// ---------------------------------------------------------------------------
// CLEANING & DISINFECTION
// ---------------------------------------------------------------------------

export const CLEANING_SCOPES = [
  'PRODUCTION_UNIT',
  'STORE',
  'EQUIPMENT',
  'VEHICLE',
  'SITE_AREA',
] as const;
export type CleaningScope = (typeof CLEANING_SCOPES)[number];

export const SCOPE_LABELS: Record<CleaningScope, string> = {
  PRODUCTION_UNIT: 'A house',
  STORE: 'A store room',
  EQUIPMENT: 'Equipment',
  VEHICLE: 'A vehicle',
  SITE_AREA: 'Somewhere else on the farm',
};

export const CLEANING_STAGES = [
  'DRY_CLEAN',
  'WASH',
  'DISINFECT',
  'FUMIGATE',
  'REST',
  'FULL_TURNAROUND',
] as const;
export type CleaningStage = (typeof CLEANING_STAGES)[number];

export const STAGE_LABELS: Record<CleaningStage, string> = {
  DRY_CLEAN: 'Dry clean — muck out and sweep',
  WASH: 'Wash',
  DISINFECT: 'Disinfect',
  FUMIGATE: 'Fumigate',
  REST: 'Rest — left empty',
  FULL_TURNAROUND: 'Full turnaround, all stages',
};

/**
 * The stages that count as having cleaned a place.
 *
 * A REST period is time passing, not work done, and a dry clean on its own is
 * half a job. Neither should reset the interval clock on a house — a screen
 * that said "cleaned 2 days ago" because somebody recorded that the house was
 * standing empty would be reporting the opposite of the truth.
 */
export const STAGES_THAT_RESET_THE_CLOCK: readonly CleaningStage[] = [
  'DISINFECT',
  'FUMIGATE',
  'FULL_TURNAROUND',
];

const positiveInt = (max: number, message: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v > 0 && v <= max), message);

export const cleaningSchema = z
  .object({
    siteId: z.string().trim().min(1, 'Choose a farm.'),
    scope: z.enum(CLEANING_SCOPES, { message: 'What was cleaned?' }),
    productionUnitId: optionalText(40),
    areaName: optionalText(80),
    stage: z.enum(CLEANING_STAGES, { message: 'Which part of the job?' }),
    performedOn: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.')
      .transform((v) => new Date(`${v}T00:00:00.000Z`)),
    performedBy: optionalText(80),
    itemId: optionalText(40),
    /** In the item's own unit, as typed. Converted by the service. */
    quantity: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v === undefined || v === '' ? null : Number(v)))
      .refine((v) => v === null || (Number.isFinite(v) && v > 0), 'Enter how much was used.'),
    stockLocationId: optionalText(40),
    dilution: optionalText(40),
    contactTimeMinutes: positiveInt(1440, 'Enter a whole number of minutes, up to a day.'),
    notes: optionalText(500),
  })
  .refine((v) => v.scope !== 'PRODUCTION_UNIT' || v.productionUnitId !== null, {
    path: ['productionUnitId'],
    message: 'Which house?',
  })
  .refine(
    (v) => v.scope === 'PRODUCTION_UNIT' || v.areaName !== null,
    { path: ['areaName'], message: 'Name what was cleaned.' },
  )
  .refine((v) => v.itemId === null || v.quantity !== null, {
    path: ['quantity'],
    message: 'How much of it was used?',
  })
  .refine((v) => v.itemId === null || v.stockLocationId !== null, {
    path: ['stockLocationId'],
    message: 'Which store did it come out of?',
  });

export type CleaningInput = z.infer<typeof cleaningSchema>;

/** How often a place should be cleaned. Blank means nobody is measuring it. */
export const cleaningIntervalSchema = z.object({
  cleaningIntervalDays: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : Number(v)))
    .refine(
      (v) => v === null || (Number.isInteger(v) && v > 0 && v <= 365),
      'Enter a whole number of days, up to a year — or leave it blank.',
    ),
});

// ---------------------------------------------------------------------------
// INSPECTIONS
// ---------------------------------------------------------------------------

export const CHECK_RESULTS = ['PASS', 'FAIL', 'NOT_CHECKED', 'NOT_APPLICABLE'] as const;
export type CheckResultValue = (typeof CHECK_RESULTS)[number];

export const RESULT_LABELS: Record<CheckResultValue, string> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  NOT_CHECKED: 'Not checked',
  NOT_APPLICABLE: 'N/A',
};

/**
 * Common starting points for a poultry biosecurity checklist.
 *
 * OFFERED, NEVER IMPOSED, AND NOT A STANDARD. These are prompts to go and look
 * at something — not clinical instructions, and not an audit scheme. What
 * actually matters on a particular farm depends on its layout, its neighbours
 * and whoever buys from it, so every line here is editable, removable, and
 * placed on screen under a sentence saying exactly that.
 *
 * The distinction from the vaccination schedule, which this system deliberately
 * refuses to author: getting one of these wrong means somebody looked at the
 * wrong thing. Getting a vaccination schedule wrong means something went into a
 * bird, and from there into food.
 */
export const STARTER_CHECKLIST: { label: string; guidance: string }[] = [
  { label: 'Perimeter fence intact', guidance: 'Walk the boundary. Look for gaps at ground level.' },
  { label: 'Gate closed and controlled', guidance: 'Can a vehicle reach the houses without anyone knowing?' },
  { label: 'Footbath charged and clean', guidance: 'Not just present — is the solution fresh and not full of mud?' },
  { label: 'Visitor book at the entrance', guidance: 'Is it where a visitor would actually see it?' },
  { label: 'Farm clothing and boots available', guidance: 'Enough sets for the visitors you get.' },
  { label: 'No rodent activity', guidance: 'Droppings, gnawed bags, runs behind the feed store.' },
  { label: 'Wild birds excluded from houses', guidance: 'Check netting, vents and any broken mesh.' },
  { label: 'Feed store closed and dry', guidance: 'Spilled feed outside a store is a rodent invitation.' },
  { label: 'Water source protected', guidance: 'Covered tank, no standing water birds can reach.' },
  { label: 'Dead birds removed and disposed of', guidance: 'How, and how quickly?' },
  { label: 'Litter and manure stored away from houses', guidance: 'And away from the route feed comes in on.' },
  { label: 'Equipment not shared with other farms', guidance: 'Crates, trolleys and vehicles especially.' },
];

export const checklistSchema = z.object({
  name: z.string().trim().min(2, 'Give the checklist a name.').max(80),
  description: optionalText(300),
});

export const checklistItemSchema = z.object({
  label: z.string().trim().min(3, 'What should the person look at?').max(120),
  guidance: optionalText(300),
});

export const checkSchema = z.object({
  siteId: z.string().trim().min(1, 'Choose a farm.'),
  checklistId: z.string().trim().min(1, 'Choose a checklist.'),
  performedOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.')
    .transform((v) => new Date(`${v}T00:00:00.000Z`)),
  performedBy: optionalText(80),
  notes: optionalText(500),
});

export type ChecklistInput = z.infer<typeof checklistSchema>;
export type ChecklistItemInput = z.infer<typeof checklistItemSchema>;
export type CheckInput = z.infer<typeof checkSchema>;

/**
 * The per-line answers, which arrive as `result:<itemId>` and `note:<itemId>`.
 *
 * A LINE NOBODY ANSWERED COMES BACK AS NOT_CHECKED, never as a pass. The whole
 * value of an inspection record is that it distinguishes what was looked at
 * from what was not.
 */
export function parseCheckLines(
  formData: FormData,
): { itemId: string; result: CheckResultValue; note: string | null }[] {
  const results = new Map<string, CheckResultValue>();
  const notes = new Map<string, string>();

  for (const [key, value] of formData.entries()) {
    const raw = String(value).trim();
    if (key.startsWith('result:')) {
      const itemId = key.slice('result:'.length);
      results.set(
        itemId,
        (CHECK_RESULTS as readonly string[]).includes(raw)
          ? (raw as CheckResultValue)
          : 'NOT_CHECKED',
      );
    } else if (key.startsWith('note:')) {
      const itemId = key.slice('note:'.length);
      if (raw !== '') notes.set(itemId, raw.slice(0, 300));
    }
  }

  return [...results.entries()].map(([itemId, result]) => ({
    itemId,
    result,
    note: notes.get(itemId) ?? null,
  }));
}

/** A stable key from a label, so a rewording does not orphan past answers. */
export function checklistItemKeyFrom(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}
