import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { warningToken, type Warning } from '@/lib/warnings';
import {
  kindLabel,
  previewOf,
  previewSentence,
  toLayCurveMap,
  toStandardMap,
  type StandardKind,
  type TablePreview,
} from '@/lib/standards';
import { weightStandardFrom } from '@/lib/rearing';
import { layStandardFrom } from '@/lib/production';

/**
 * Breed standards service — ADRAH Farms
 *
 * THE ONLY PLACE `Breed.standards` IS WRITTEN from the application.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 *
 * The arithmetic for judging a flock against its breed was already built: the
 * weight curve, the lay curve, the interpolation between published points, the
 * "points behind standard" figure, and screens that display all of it. And every
 * one of those screens showed a dash, because no breed had any figures in it and
 * the only way to load them was a command-line script.
 *
 * The weights screen went as far as telling a farm owner to run
 * `npm run standards:load`. That is an instruction a person running a poultry
 * farm in New Edubiase cannot follow, which made the whole comparison inert —
 * built, tested, and incapable of firing. Same shape as a reconciliation that
 * compares a ledger against itself: the machinery is right and nothing reaches
 * it.
 *
 * ── THE ONE DANGEROUS MISTAKE ───────────────────────────────────────────────
 *
 * The two tables are indistinguishable at a glance. Both are two columns of
 * numbers out of a management guide. A lay curve loaded into the weight column
 * gives a target of 28 grams at week 20 — a plausible number, completely wrong,
 * and nothing downstream can tell. So the kind is detected, SAID OUT LOUD, and
 * agreed to before anything is written, with the agreement bound to the pasted
 * text through the same warning-token machinery the rest of the system uses.
 *
 * ── AND NOTHING IS INVENTED ─────────────────────────────────────────────────
 *
 * This module parses what somebody pasted. It ships no figures, has no defaults
 * and extrapolates nothing. A breed with no table reports no comparison, which
 * is the honest answer and the one the screens already give.
 */

export class BreedStandardsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BreedStandardsError';
  }
}

// ---------------------------------------------------------------------------
// READING
// ---------------------------------------------------------------------------

export interface BreedStandards {
  id: string;
  key: string;
  name: string;
  /** How many published points each table holds. Zero means none loaded. */
  weightPoints: number;
  layPoints: number;
  weightSource: string | null;
  weightLoadedAt: string | null;
  laySource: string | null;
  layLoadedAt: string | null;
  /** The age range each table covers, for the screen to state its limits. */
  weightRange: { fromDays: number; toDays: number } | null;
  layRange: { fromDays: number; toDays: number } | null;
  /** Flocks currently carrying this breed — who is affected by loading it. */
  flockCount: number;
}

function rangeOf(standard: Record<number, number>): { fromDays: number; toDays: number } | null {
  const ages = Object.keys(standard)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (ages.length === 0) return null;
  return { fromDays: ages[0], toDays: ages[ages.length - 1] };
}

function textField(standards: unknown, key: string): string | null {
  if (!standards || typeof standards !== 'object') return null;
  const value = (standards as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

/**
 * Every breed in the catalogue and what it has been given.
 *
 * BREEDS ARE ORGANISATION-SCOPED through their production type, like the rest of
 * the catalogue. The flock count comes along because it answers the question
 * somebody actually has: does loading this change anything today?
 */
export async function listBreedStandards(principal: Principal): Promise<BreedStandards[]> {
  const breeds = await db.breed.findMany({
    where: { productionType: { speciesProfile: { organisationId: principal.organisationId } } },
    orderBy: { name: 'asc' },
    include: { _count: { select: { animalGroups: true } } },
  });

  return breeds.map((breed) => {
    const weight = weightStandardFrom(breed.standards);
    const lay = layStandardFrom(breed.standards);
    return {
      id: breed.id,
      key: breed.key,
      name: breed.name,
      weightPoints: Object.keys(weight).length,
      layPoints: Object.keys(lay).length,
      weightSource: textField(breed.standards, 'bodyWeightSource'),
      weightLoadedAt: textField(breed.standards, 'bodyWeightLoadedAt'),
      laySource: textField(breed.standards, 'henDayPctSource'),
      layLoadedAt: textField(breed.standards, 'henDayPctLoadedAt'),
      weightRange: rangeOf(weight),
      layRange: rangeOf(lay),
      flockCount: breed._count.animalGroups,
    };
  });
}

export async function breedStandardsById(
  principal: Principal,
  breedId: string,
): Promise<BreedStandards | null> {
  const all = await listBreedStandards(principal);
  return all.find((b) => b.id === breedId) ?? null;
}

// ---------------------------------------------------------------------------
// WRITING
// ---------------------------------------------------------------------------

export interface SaveStandardInput {
  breedId: string;
  /** The table, exactly as pasted out of the guide. */
  table: string;
  /** Set only when the detection was overridden by hand. */
  kindOverride?: StandardKind | null;
  /** Which edition of which guide this came from, in the farm's own words. */
  sourceNote?: string | null;
}

export type SaveStandardResult =
  | { status: 'refused'; messages: string[]; preview: TablePreview }
  | { status: 'needsConfirmation'; warnings: Warning[]; token: string; preview: TablePreview }
  | { status: 'saved'; kind: StandardKind; points: number; breedName: string };

/**
 * What the person must agree to before a table is written.
 *
 * THE DETECTED KIND IS ALWAYS IN HERE, even when nothing looks wrong. It is not
 * a warning about a problem — it is the one interpretation that cannot be
 * checked afterwards, so it is confirmed every time rather than only when the
 * software is unsure. Binding it to the pasted content through `warningToken`
 * means correcting the table and resubmitting asks again.
 */
function confirmations(preview: TablePreview, breedName: string): Warning[] {
  const out: Warning[] = [];
  if (!preview.kind) return out;

  out.push({
    field: 'table',
    message: `${previewSentence(preview)} This will be saved against ${breedName} as its ${kindLabel(
      preview.kind,
    )}. Check that is the right table and the right breed — a lay curve saved as body weight gives targets that look plausible and are nonsense.`,
  });

  for (const warning of preview.warnings) {
    out.push({ field: 'table', message: warning });
  }

  return out;
}

export async function saveStandard(
  principal: Principal,
  input: SaveStandardInput,
  acknowledgedToken: string | null = null,
): Promise<SaveStandardResult> {
  const breed = await db.breed.findFirst({
    where: {
      id: input.breedId,
      productionType: { speciesProfile: { organisationId: principal.organisationId } },
    },
    select: { id: true, name: true, standards: true },
  });

  const preview = previewOf(input.table, input.kindOverride ?? undefined);

  if (!breed) {
    return { status: 'refused', messages: ['That breed is no longer in the catalogue.'], preview };
  }
  if (preview.errors.length > 0) {
    return { status: 'refused', messages: preview.errors, preview };
  }
  if (!preview.kind || preview.points.length === 0) {
    return {
      status: 'refused',
      messages: ['Nothing could be read from that. Paste the two columns from the guide.'],
      preview,
    };
  }

  const warnings = confirmations(preview, breed.name);
  const token = warningToken(warnings);
  if (acknowledgedToken !== token) {
    return { status: 'needsConfirmation', warnings, token, preview };
  }

  /**
   * MERGED, NEVER REPLACED.
   *
   * One JSON column holds both tables plus the brooding curve. Writing
   * `{ henDayPctByAgeDays: ... }` would silently delete a weight table loaded
   * last month — and the screens would go back to showing dashes with no
   * explanation of why.
   */
  const existing =
    breed.standards && typeof breed.standards === 'object' && !Array.isArray(breed.standards)
      ? (breed.standards as Record<string, unknown>)
      : {};

  const loadedAt = new Date().toISOString();
  // Where it came from, kept beside the figures. The command-line loader stores
  // the filename here; pasted in, it is whatever the person says the source was.
  const source = input.sourceNote?.trim() || 'Pasted in by hand';

  const standards =
    preview.kind === 'weight'
      ? {
          ...existing,
          bodyWeightByAgeDays: toStandardMap(
            preview.points.map((p) => ({ ageDays: p.ageDays, grams: p.value })),
          ),
          bodyWeightSource: source,
          bodyWeightLoadedAt: loadedAt,
        }
      : {
          ...existing,
          henDayPctByAgeDays: toLayCurveMap(
            preview.points.map((p) => ({ ageDays: p.ageDays, pct: p.value })),
          ),
          henDayPctSource: source,
          henDayPctLoadedAt: loadedAt,
        };

  await db.breed.update({ where: { id: breed.id }, data: { standards } });

  return {
    status: 'saved',
    kind: preview.kind,
    points: preview.points.length,
    breedName: breed.name,
  };
}

/**
 * Take a table back off a breed.
 *
 * A DELETE RATHER THAN A CORRECTION, and this is the one place in the system
 * where that is right: a standard is not a record of anything that happened. It
 * is reference data copied out of a book, and the fix for the wrong book is to
 * remove it and paste the right one. Removing it returns the screens to saying
 * no comparison is possible, which is true.
 */
export async function clearStandard(
  principal: Principal,
  breedId: string,
  kind: StandardKind,
): Promise<{ breedName: string }> {
  const breed = await db.breed.findFirst({
    where: {
      id: breedId,
      productionType: { speciesProfile: { organisationId: principal.organisationId } },
    },
    select: { id: true, name: true, standards: true },
  });
  if (!breed) throw new BreedStandardsError('That breed is no longer in the catalogue.');

  const existing =
    breed.standards && typeof breed.standards === 'object' && !Array.isArray(breed.standards)
      ? ({ ...(breed.standards as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  for (const key of kind === 'weight'
    ? ['bodyWeightByAgeDays', 'bodyWeightSource', 'bodyWeightLoadedAt']
    : ['henDayPctByAgeDays', 'henDayPctSource', 'henDayPctLoadedAt']) {
    delete existing[key];
  }

  await db.breed.update({
    where: { id: breed.id },
    data: { standards: existing as Prisma.InputJsonValue },
  });
  return { breedName: breed.name };
}
