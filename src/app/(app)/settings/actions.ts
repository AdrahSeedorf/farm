'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { organisationSchema, breedSchema, fieldErrorsFrom } from '@/lib/validation/site';
import { productionGradeSchema, gradeKeyFrom } from '@/lib/validation/production';
import type { FormState } from '../sites/actions';

export async function updateOrganisation(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const principal = await requirePermission('settings:manage');

  const parsed = organisationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const before = await db.organisation.findUnique({
    where: { id: principal.organisationId },
  });
  if (!before) return { error: 'Organisation not found.' };

  // The form field is called `pulletMarketPrice` and holds cedis; the column is
  // called `pulletMarketPricePesewas` and holds pesewas. Mapped here rather than
  // named alike, so nothing can ever write a cedi figure into a pesewa column
  // and quietly make every pullet a hundred times cheaper.
  const { pulletMarketPrice, ...fields } = parsed.data;

  const after = await db.organisation.update({
    where: { id: principal.organisationId },
    data: { ...fields, pulletMarketPricePesewas: pulletMarketPrice },
  });

  await recordAudit({
    principal,
    action: 'organisation.update',
    entityType: 'Organisation',
    entityId: after.id,
    before,
    after,
  });

  revalidatePath('/settings');
  return { error: undefined, fieldErrors: undefined };
}

/**
 * Add a breed to the catalogue.
 *
 * The NAME only. Weight figures are loaded from the breeder's own management
 * guide with `npm run standards:load`, because a curve typed in by hand is a
 * curve nobody can trace back to a source — and a flock would then be judged
 * behind target against numbers with no provenance.
 */
export async function addBreed(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePermission('settings:manage');

  const parsed = breedSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const input = parsed.data;

  // Derived so the loader has something stable to target on the command line.
  const key = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const existing = await db.breed.findFirst({
    where: { organisationId: principal.organisationId, key },
  });
  if (existing) {
    return { fieldErrors: { name: `${existing.name} is already in the catalogue.` } };
  }

  const breed = await db.breed.create({
    data: {
      organisationId: principal.organisationId,
      key,
      name: input.name,
      supplier: input.supplier,
    },
  });

  await recordAudit({
    principal,
    action: 'organisation.update',
    entityType: 'Breed',
    entityId: breed.id,
    after: { key, name: input.name, supplier: input.supplier },
  });

  revalidatePath('/settings');
  return { ok: `${breed.name} added. Load its weight table with: npm run standards:load -- <file.csv> --breed ${key}` };
}

// ---------------------------------------------------------------------------
// PRODUCTION GRADES
//
// The bands the farm sorts its output into. Configuration, held at owner level
// like every other vocabulary in this system: `isSaleable` decides what may
// eventually be put on an invoice, and that is not a decision a shift should be
// able to change on a busy morning.
// ---------------------------------------------------------------------------

/**
 * One grade, fetched only if it belongs to this principal's organisation.
 *
 * The ownership test is IN THE QUERY rather than an `if` afterwards — a grade
 * from another organisation comes back as null and is indistinguishable from one
 * that never existed. See src/lib/scope.ts.
 */
async function ownedGrade(gradeId: string, organisationId: string) {
  return db.productionGrade.findFirst({
    where: {
      id: gradeId,
      productionType: { speciesProfile: { organisationId } },
    },
  });
}


/**
 * Check a grade may claim this store item before writing.
 *
 * `ProductionGrade.itemId` is UNIQUE, so the database already refuses two
 * grades pointing at one item — they would each add their eggs to it and the
 * store would hold twice what the farm collected. This turns that refusal into
 * a sentence naming the grade that has it, because a unique-constraint error
 * reaching a settings screen tells nobody anything.
 */
async function itemClaimError(
  itemId: string | null,
  organisationId: string,
  exceptGradeId?: string,
): Promise<Record<string, string> | null> {
  if (itemId === null) return null;

  const item = await db.item.findFirst({
    where: { id: itemId, organisationId },
    select: { id: true, isActive: true, name: true },
  });
  if (!item) return { itemId: 'That store item no longer exists.' };
  if (!item.isActive) {
    return { itemId: `${item.name} is archived. Restore it first, or choose another item.` };
  }

  const taken = await db.productionGrade.findFirst({
    where: { itemId, NOT: exceptGradeId ? { id: exceptGradeId } : undefined },
    select: { name: true },
  });
  if (taken) {
    return {
      itemId:
        `${item.name} is already held by the ${taken.name} grade. Two grades sharing one ` +
        `item would each add their produce to it, and the store would say it holds twice ` +
        `what was collected.`,
    };
  }
  return null;
}

export async function addProductionGrade(
  productionTypeProfileId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const principal = await requirePermission('settings:manage');

  const profile = await db.productionTypeProfile.findFirst({
    where: {
      id: productionTypeProfileId,
      speciesProfile: { organisationId: principal.organisationId },
    },
    select: { id: true },
  });
  if (!profile) return { error: 'That production type no longer exists.' };

  const parsed = productionGradeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const input = parsed.data;

  const key = gradeKeyFrom(input.name);
  if (key === '') return { fieldErrors: { name: 'Use at least two letters or numbers.' } };

  const existing = await db.productionGrade.findFirst({
    where: { productionTypeProfileId: profile.id, key },
  });
  if (existing) {
    return {
      fieldErrors: {
        name: existing.isActive
          ? `${existing.name} is already a grade.`
          : `${existing.name} exists but is retired. Restore it rather than adding it again.`,
      },
    };
  }

  // Appended to the end of the list. Order is what makes a collection screen
  // readable at a glance, and it is the farm's to set — not alphabetical, which
  // would put "Cracked" above "Large".
  const last = await db.productionGrade.aggregate({
    where: { productionTypeProfileId: profile.id },
    _max: { sortOrder: true },
  });

  const piece = await db.unitOfMeasure.findUnique({ where: { key: 'piece' } });
  if (!piece) return { error: 'The unit catalogue is not set up. Run the seed first.' };

  const claim = await itemClaimError(input.itemId, principal.organisationId);
  if (claim) return { fieldErrors: claim };

  const grade = await db.productionGrade.create({
    data: {
      productionTypeProfileId: profile.id,
      key,
      name: input.name,
      isSaleable: input.isSaleable,
      minGrams: input.minGrams,
      maxGrams: input.maxGrams,
      itemId: input.itemId,
      baseUomId: piece.id,
      sortOrder: (last._max.sortOrder ?? 0) + 1,
    },
  });

  await recordAudit({
    principal,
    action: 'productionGrade.create',
    entityType: 'ProductionGrade',
    entityId: grade.id,
    after: {
      key,
      name: grade.name,
      isSaleable: grade.isSaleable,
      minGrams: grade.minGrams,
      maxGrams: grade.maxGrams,
      itemId: grade.itemId,
    },
  });

  revalidatePath('/settings/grades');
  return { ok: `${grade.name} added.` };
}

export async function updateProductionGrade(
  gradeId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const principal = await requirePermission('settings:manage');

  const before = await ownedGrade(gradeId, principal.organisationId);
  if (!before) return { error: 'That grade no longer exists.' };

  const parsed = productionGradeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const input = parsed.data;

  const claim = await itemClaimError(input.itemId, principal.organisationId, before.id);
  if (claim) return { fieldErrors: claim };

  // THE KEY IS NEVER REWRITTEN. It is what every existing production line, every
  // export and the seed all refer to; renaming "Large" to "Grade A" should change
  // what the screen says, not orphan a year of records.
  const after = await db.productionGrade.update({
    where: { id: before.id },
    data: {
      name: input.name,
      isSaleable: input.isSaleable,
      minGrams: input.minGrams,
      maxGrams: input.maxGrams,
      itemId: input.itemId,
    },
  });

  await recordAudit({
    principal,
    action: 'productionGrade.update',
    entityType: 'ProductionGrade',
    entityId: after.id,
    before,
    after,
  });

  revalidatePath('/settings/grades');
  return { ok: `${after.name} saved.` };
}

/**
 * Retire a grade, or bring one back.
 *
 * NEVER A DELETE. Production lines point at grades, and a deleted grade would
 * either take a year of collections with it or leave rows nobody can name. A
 * retired grade stops being offered on the collection screen and keeps every
 * figure ever recorded against it.
 */
export async function setProductionGradeActive(
  gradeId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const principal = await requirePermission('settings:manage');

  const before = await ownedGrade(gradeId, principal.organisationId);
  if (!before) return { error: 'That grade no longer exists.' };

  // The intent is stated by the form rather than inferred from current state:
  // two people on the same screen would otherwise toggle each other's change.
  const isActive = formData.get('intent') === 'restore';

  const after = await db.productionGrade.update({
    where: { id: before.id },
    data: { isActive },
  });

  await recordAudit({
    principal,
    action: isActive ? 'productionGrade.update' : 'productionGrade.archive',
    entityType: 'ProductionGrade',
    entityId: after.id,
    before,
    after,
  });

  revalidatePath('/settings/grades');
  return { ok: isActive ? `${after.name} restored.` : `${after.name} retired.` };
}
