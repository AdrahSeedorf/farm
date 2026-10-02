import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, siteFilter, canAccessSite } from '@/lib/scope';
import { warningToken, type Warning } from '@/lib/warnings';
import {
  MODE_LABELS,
  SUPPLEMENT_MODES,
  latitudeNote,
  nextStep,
  planFor,
  practicalityNote,
  programmeWarnings,
  sortSteps,
  stepAt,
  stepErrors,
  sunTimes,
  type LightingPlan,
  type LightingStep,
  type SunTimes,
  type SupplementMode,
} from '@/lib/lighting';
import {
  DRAFT_LIGHTING_ITEMS,
  DRAFT_LIGHTING_NAME,
  DRAFT_LIGHTING_SOURCE,
} from '@/lib/draft-lighting';
import { ageInDays } from '@/lib/metrics';

/**
 * Lighting service — ADRAH Farms
 *
 * THE ONLY PLACE A LightingProgramme OR LightingStep IS WRITTEN.
 *
 * THE LATITUDE IS READ FROM THE SITE AND NEVER ASSUMED.
 *
 *   Everything useful here — the switch-on time, the lamp hours, whether a step
 *   is even achievable — comes from how long the day is, which comes from where
 *   the farm is. `Site.latitude` is nullable and nothing fills it in.
 *
 *   It would be easy to default to 6°N on the grounds that the farm is in Ghana.
 *   That would be a guess wearing the clothes of a measurement, and it would be
 *   wrong the first time this software is used anywhere else — including by a
 *   second site of this same business. Where there is no latitude, every screen
 *   says so and offers no times at all. A missing figure that announces itself
 *   is recoverable; an invented one is not.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: it does not record whether the lights were
 * actually switched on. That is a daily observation and it belongs with the
 * daily record, next to the other things somebody walking the house writes down
 * — not in a second parallel log that would immediately disagree with the first.
 * This module answers "what should the lights be doing today, and why", which is
 * the question that has no answer at all right now.
 */

export class LightingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LightingError';
  }
}

// ---------------------------------------------------------------------------
// READING
// ---------------------------------------------------------------------------

export interface Programme {
  id: string;
  name: string;
  description: string | null;
  supplementMode: SupplementMode;
  sourceNote: string | null;
  isDraft: boolean;
  isDefault: boolean;
  isActive: boolean;
  productionTypeName: string | null;
  steps: (LightingStep & { id: string })[];
}

const include = {
  productionType: { select: { name: true } },
  steps: { orderBy: { ageDays: 'asc' } },
} as const;

function toProgramme(row: {
  id: string;
  name: string;
  description: string | null;
  supplementMode: string;
  sourceNote: string | null;
  isDraft: boolean;
  isDefault: boolean;
  isActive: boolean;
  productionType: { name: string } | null;
  steps: { id: string; ageDays: number; totalHours: number; lux: number | null; note: string | null }[];
}): Programme {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    // Narrowed on the way out rather than trusted. The column is text so that
    // a fourth mode does not need a migration; that freedom is paid for here.
    supplementMode: (SUPPLEMENT_MODES as readonly string[]).includes(row.supplementMode)
      ? (row.supplementMode as SupplementMode)
      : 'MORNING',
    sourceNote: row.sourceNote,
    isDraft: row.isDraft,
    isDefault: row.isDefault,
    isActive: row.isActive,
    productionTypeName: row.productionType?.name ?? null,
    steps: row.steps.map((s) => ({
      id: s.id,
      ageDays: s.ageDays,
      totalHours: s.totalHours,
      lux: s.lux,
      note: s.note,
    })),
  };
}

export async function listProgrammes(principal: Principal): Promise<Programme[]> {
  const rows = await db.lightingProgramme.findMany({
    where: orgFilter(principal),
    orderBy: [{ isActive: 'desc' }, { isDefault: 'desc' }, { name: 'asc' }],
    include,
  });
  return rows.map(toProgramme);
}

export async function programmeById(
  principal: Principal,
  id: string,
): Promise<Programme | null> {
  const row = await db.lightingProgramme.findFirst({
    where: { id, ...orgFilter(principal) },
    include,
  });
  return row ? toProgramme(row) : null;
}

/** The programme a group of this production type follows when nothing says otherwise. */
export async function defaultProgramme(
  principal: Principal,
  productionTypeProfileId: string | null,
): Promise<Programme | null> {
  const row = await db.lightingProgramme.findFirst({
    where: {
      ...orgFilter(principal),
      isActive: true,
      isDefault: true,
      // A programme scoped to this production type beats an unscoped one; an
      // unscoped programme still applies, which is what `null` means on it.
      OR: [{ productionTypeProfileId }, { productionTypeProfileId: null }],
    },
    orderBy: { productionTypeProfileId: 'desc' },
    include,
  });
  return row ? toProgramme(row) : null;
}

// ---------------------------------------------------------------------------
// WHAT THE LIGHTS SHOULD BE DOING TODAY
// ---------------------------------------------------------------------------

export interface HouseLighting {
  flockId: string;
  flockCode: string;
  unitName: string | null;
  siteName: string;
  ageDays: number;
  ageWeeks: number;
  programmeId: string | null;
  programmeName: string | null;
  isDraft: boolean;
  /** Null where no latitude is recorded, or no programme covers this age. */
  plan: LightingPlan | null;
  /** Whether anybody will actually be awake to do it. Null when it is fine. */
  practicality: string | null;
  sun: SunTimes | null;
  /** The step in force, and the one coming next. */
  current: LightingStep | null;
  upcoming: { step: LightingStep; inDays: number } | null;
  /** Said on every screen where it applies. */
  note: string;
}

/**
 * Every laying-age group this person can see, and what its lights should do.
 *
 * SITE SCOPING IS IN THE WHERE CLAUSE. A supervisor who covers one farm gets one
 * farm's houses, filtered by the database rather than by the page.
 */
export async function lightingToday(
  principal: Principal,
  today: Date = new Date(),
): Promise<HouseLighting[]> {
  const groups = await db.animalGroup.findMany({
    where: {
      site: orgFilter(principal),
      ...siteFilter(principal),
      // A closed group has no lights to set. Filtered in the WHERE clause
      // rather than after the fetch, like every other scope in this system.
      closedAt: null,
    },
    orderBy: { code: 'asc' },
    include: {
      site: { select: { name: true, latitude: true, longitude: true } },
      productionUnit: { select: { name: true } },
      productionType: { select: { id: true } },
    },
  });

  const out: HouseLighting[] = [];
  for (const group of groups) {
    const programme = await defaultProgramme(
      principal,
      group.productionType?.id ?? null,
    );
    const ageDays = ageInDays(group.dateOfHatch, today) ?? 0;
    const step = programme ? stepAt(sortSteps(programme.steps), ageDays) : null;
    const ahead = programme ? nextStep(sortSteps(programme.steps), ageDays) : null;

    const lat = group.site.latitude;
    const lon = group.site.longitude;
    const sun =
      lat === null || lon === null ? null : sunTimes(lat, lon, today);

    const plan =
      step && sun ? planFor(step.totalHours, sun, programme!.supplementMode) : null;

    out.push({
      flockId: group.id,
      flockCode: group.code,
      unitName: group.productionUnit?.name ?? null,
      siteName: group.site.name,
      ageDays,
      ageWeeks: Math.floor(ageDays / 7),
      programmeId: programme?.id ?? null,
      programmeName: programme?.name ?? null,
      isDraft: programme?.isDraft ?? false,
      plan,
      practicality:
        plan && programme ? practicalityNote(plan, programme.supplementMode) : null,
      sun,
      current: step,
      upcoming: ahead ? { step: ahead, inDays: ahead.ageDays - ageDays } : null,
      note: noteFor({ programme, step, sun, latitude: lat }),
    });
  }

  return out;
}

function noteFor(args: {
  programme: Programme | null;
  step: LightingStep | null;
  sun: SunTimes | null;
  latitude: number | null;
}): string {
  if (!args.programme) {
    return 'No lighting programme is set as the default, so nothing can be said about this house. Health → Lighting.';
  }
  if (args.latitude === null || args.sun === null) {
    return 'This farm has no latitude recorded, so the natural daylength cannot be worked out and no switch-on time can be given. Settings → Farms.';
  }
  if (!args.step) {
    return `The programme's first instruction is for an older bird, so it says nothing about this group yet.`;
  }
  return '';
}

/** The latitude sentence for a site, for the screens that explain the cost. */
export async function siteLatitudeNote(
  principal: Principal,
  siteId: string,
  layingTargetHours: number | null,
  today: Date = new Date(),
): Promise<string> {
  if (!canAccessSite(principal, siteId)) return 'That farm is not one you cover.';

  const site = await db.site.findFirst({
    where: { id: siteId, ...orgFilter(principal) },
    select: { latitude: true, longitude: true },
  });
  if (!site) return 'That farm no longer exists.';

  const sun =
    site.latitude === null || site.longitude === null
      ? null
      : sunTimes(site.latitude, site.longitude, today);
  return latitudeNote(site.latitude, sun, layingTargetHours);
}

// ---------------------------------------------------------------------------
// WRITING
// ---------------------------------------------------------------------------

export interface SaveStepInput {
  programmeId: string;
  ageDays: number;
  totalHours: number;
  lux: number | null;
  note: string | null;
}

export type SaveStepResult =
  | { status: 'refused'; message: string }
  | { status: 'needsConfirmation'; warnings: Warning[]; token: string }
  | { status: 'saved'; id: string };

/**
 * Add or correct one instruction.
 *
 * WARNINGS ARE COMPUTED AGAINST THE WHOLE PROGRAMME AS IT WOULD BE, not against
 * the step on its own. "Day 200 shortens the day" is only knowable by looking at
 * day 199, and a check that looked at one row at a time would never fire the one
 * warning that matters most.
 */
export async function saveStep(
  principal: Principal,
  input: SaveStepInput,
  acknowledgedToken: string | null = null,
): Promise<SaveStepResult> {
  const programme = await db.lightingProgramme.findFirst({
    where: { id: input.programmeId, ...orgFilter(principal) },
    include: {
      steps: true,
      productionType: {
        select: {
          lifecycleStages: {
            where: { isProductionStart: true },
            select: { typicalStartAgeDays: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!programme) return { status: 'refused', message: 'That programme no longer exists.' };

  const problems = stepErrors(input);
  if (problems.length > 0) return { status: 'refused', message: problems[0] };

  const proposed: LightingStep[] = [
    ...programme.steps
      .filter((s) => s.ageDays !== input.ageDays)
      .map((s) => ({ ageDays: s.ageDays, totalHours: s.totalHours, lux: s.lux })),
    { ageDays: input.ageDays, totalHours: input.totalHours, lux: input.lux },
  ];

  const warnings = programmeWarnings(proposed, {
    // WHICH STAGE STARTS PRODUCTION IS DATA, not a key read in code — so the
    // "after the birds are in lay" warning works for any species.
    productionStartAgeDays:
      programme.productionType?.lifecycleStages[0]?.typicalStartAgeDays ?? null,
    // ONLY THIS STEP'S OWN WARNINGS, and deliberately NOT the blank-lux one.
    //
    // "Nobody has measured the light level" is true of almost every row on
    // almost every farm, and making it a confirmation meant every single save
    // needed two clicks. A warning that fires on every correct action is how
    // people learn to click past the one that mattered — so it lives on the
    // programme screen as information instead, where it can be read once.
  }).filter((w) => w.field === `step-${input.ageDays}`);

  if (warnings.length > 0) {
    const token = warningToken(warnings);
    if (acknowledgedToken !== token) return { status: 'needsConfirmation', warnings, token };
  }

  const saved = await db.lightingStep.upsert({
    where: { programmeId_ageDays: { programmeId: programme.id, ageDays: input.ageDays } },
    create: {
      programmeId: programme.id,
      ageDays: input.ageDays,
      totalHours: input.totalHours,
      lux: input.lux,
      note: input.note?.trim() || null,
    },
    update: {
      totalHours: input.totalHours,
      lux: input.lux,
      note: input.note?.trim() || null,
    },
    select: { id: true },
  });

  // A programme that has been edited is no longer the shipped starting point,
  // whatever it is called. Leaving `isDraft` true would keep warning a farm
  // about numbers they themselves put in.
  if (programme.isDraft) {
    await db.lightingProgramme.update({
      where: { id: programme.id },
      data: { isDraft: false },
    });
  }

  return { status: 'saved', id: saved.id };
}

export async function removeStep(principal: Principal, stepId: string): Promise<void> {
  const step = await db.lightingStep.findFirst({
    where: { id: stepId, programme: orgFilter(principal) },
    select: { id: true },
  });
  if (!step) throw new LightingError('That step no longer exists.');
  await db.lightingStep.delete({ where: { id: step.id } });
}

export async function setSupplementMode(
  principal: Principal,
  programmeId: string,
  mode: SupplementMode,
): Promise<void> {
  if (!(SUPPLEMENT_MODES as readonly string[]).includes(mode)) {
    throw new LightingError(`${mode} is not one of ${Object.keys(MODE_LABELS).join(', ')}.`);
  }
  const programme = await db.lightingProgramme.findFirst({
    where: { id: programmeId, ...orgFilter(principal) },
    select: { id: true },
  });
  if (!programme) throw new LightingError('That programme no longer exists.');
  await db.lightingProgramme.update({ where: { id: programme.id }, data: { supplementMode: mode } });
}

/**
 * Make this the programme flocks follow.
 *
 * AT MOST ONE DEFAULT PER PRODUCTION TYPE, enforced here in a transaction rather
 * than by a partial unique index — two defaults would make which one a flock
 * follows depend on row order, which is the kind of bug that only shows up once
 * somebody has acted on the wrong answer for a month.
 */
export async function makeDefault(principal: Principal, programmeId: string): Promise<void> {
  const programme = await db.lightingProgramme.findFirst({
    where: { id: programmeId, ...orgFilter(principal) },
    select: { id: true, productionTypeProfileId: true },
  });
  if (!programme) throw new LightingError('That programme no longer exists.');

  await db.$transaction(async (tx) => {
    await tx.lightingProgramme.updateMany({
      where: {
        organisationId: principal.organisationId,
        productionTypeProfileId: programme.productionTypeProfileId,
        id: { not: programme.id },
      },
      data: { isDefault: false },
    });
    await tx.lightingProgramme.update({
      where: { id: programme.id },
      data: { isDefault: true, isActive: true },
    });
  });
}

/**
 * Start the draft.
 *
 * REFUSES TO MAKE A SECOND, like the health draft. A farm with two unverified
 * drafts has one more unverified draft than it has useful information.
 */
export async function startDraftLighting(
  principal: Principal,
  options: { productionTypeProfileId?: string | null } = {},
): Promise<{ id: string; created: boolean }> {
  const existing = await db.lightingProgramme.findFirst({
    where: { ...orgFilter(principal), name: DRAFT_LIGHTING_NAME },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  /**
   * ATTACH IT TO THE FARM'S PRODUCTION TYPE WHERE THERE IS ONLY ONE.
   *
   * This is not a guess about the world — it is picking the only candidate.
   * It matters because the production type is where "when does laying start"
   * lives, and without it the warning about shortening the day cannot tell
   * rearing from lay. That was a real bug: an unattached programme received the
   * mild wording for the most damaging edit in the system.
   *
   * With more than one production type there is a genuine choice to make, so it
   * is left null and the warning says it does not know.
   */
  let productionTypeProfileId = options.productionTypeProfileId ?? null;
  if (productionTypeProfileId === null) {
    const types = await db.productionTypeProfile.findMany({
      where: { speciesProfile: { organisationId: principal.organisationId } },
      select: { id: true },
      take: 2,
    });
    if (types.length === 1) productionTypeProfileId = types[0].id;
  }

  const created = await db.$transaction(async (tx) => {
    const programme = await tx.lightingProgramme.create({
      data: {
        organisationId: principal.organisationId,
        productionTypeProfileId,
        name: DRAFT_LIGHTING_NAME,
        description:
          'A starting point for the conversation with the hatchery. Every figure here is a guess that somebody qualified should correct.',
        sourceNote: DRAFT_LIGHTING_SOURCE,
        supplementMode: 'MORNING',
        isDraft: true,
        steps: {
          create: DRAFT_LIGHTING_ITEMS.map((item) => ({
            ageDays: item.ageDays,
            totalHours: item.totalHours,
            lux: item.lux,
            note: item.note,
          })),
        },
      },
      select: { id: true, productionTypeProfileId: true },
    });
    return programme;
  });

  // Nothing else is the default yet, so a farm that has just asked for a
  // starting point gets one that actually applies rather than one they must
  // then go and switch on.
  const anyDefault = await db.lightingProgramme.findFirst({
    where: { ...orgFilter(principal), isDefault: true },
    select: { id: true },
  });
  if (!anyDefault) await makeDefault(principal, created.id);

  return { id: created.id, created: true };
}

export async function draftLighting(principal: Principal): Promise<Programme | null> {
  const row = await db.lightingProgramme.findFirst({
    where: { ...orgFilter(principal), name: DRAFT_LIGHTING_NAME },
    include,
  });
  return row ? toProgramme(row) : null;
}
