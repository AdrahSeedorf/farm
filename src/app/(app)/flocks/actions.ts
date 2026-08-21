'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { canAccessSite, orgFilter } from '@/lib/scope';
import { AuthorizationError } from '@/lib/rbac';
import { recordAnimalGroupEvent, FlockError } from '@/lib/flock-service';
import { fromCedis } from '@/lib/money';
import { isValidReason } from '@/lib/reason-codes';
import {
  placementSchema,
  flockEventSchema,
  stageChangeSchema,
} from '@/lib/validation/flock';
import { fieldErrorsFrom } from '@/lib/validation/site';
import type { FormState } from '../sites/actions';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

/**
 * Place a flock.
 *
 * Creating the flock and recording its PLACEMENT are ONE transaction. A flock
 * row without a placement event would have a population of zero and no history
 * explaining why — the exact inconsistency the ledger exists to prevent.
 *
 * Dead-on-arrival is recorded as a separate MORTALITY event rather than being
 * subtracted from the placement. You received what the supplier delivered; some
 * of them were dead. Both facts belong in the record, and DOA% is a real signal
 * about that supplier.
 */
export async function placeFlock(
  siteId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const principal = await requirePermission('flock:create', siteId);
  if (!canAccessSite(principal, siteId)) throw new AuthorizationError('flock:create', siteId);

  const parsed = placementSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const input = parsed.data;

  const unit = await db.productionUnit.findFirst({
    where: { id: input.productionUnitId, site: { id: siteId, ...orgFilter(principal) } },
    select: { id: true },
  });
  if (!unit) return { fieldErrors: { productionUnitId: 'That house does not belong to this farm.' } };

  const species = await db.speciesProfile.findFirst({
    where: { organisationId: principal.organisationId, key: 'poultry' },
    include: {
      productionTypes: { where: { key: 'layer' }, include: { lifecycleStages: { orderBy: { sequence: 'asc' } } } },
    },
  });
  const productionType = species?.productionTypes[0];
  if (!species || !productionType) {
    return { error: 'Poultry and layer profiles are missing. Run `npm run db:seed`.' };
  }
  const firstStage = productionType.lifecycleStages[0];

  let flockId: string;
  try {
    flockId = await db.$transaction(async (tx) => {
      const flock = await tx.animalGroup.create({
        data: {
          siteId,
          productionUnitId: input.productionUnitId,
          speciesProfileId: species.id,
          productionTypeProfileId: productionType.id,
          code: input.code,
          name: input.name,
          breed: input.breed,
          supplierName: input.supplierName,
          dateOfHatch: input.dateOfHatch,
          arrivalDate: input.arrivalDate,
          notes: input.notes,
          currentStageId: firstStage?.id ?? null,
        },
        select: { id: true },
      });

      if (input.purchaseCostCedis !== undefined && input.purchaseCostCedis > 0) {
        await tx.flockCostEntry.create({
          data: {
            animalGroupId: flock.id,
            category: 'STOCK_PURCHASE',
            amountPesewas: fromCedis(input.purchaseCostCedis),
            incurredOn: input.arrivalDate,
            description: 'Chick purchase',
            recordedById: principal.userId,
          },
        });
      }
      return flock.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { fieldErrors: { code: 'That flock code is already used on this farm.' } };
    }
    throw error;
  }

  // Ledger writes go through the service, which owns the signs and the guards.
  await recordAnimalGroupEvent(principal, {
    animalGroupId: flockId,
    type: 'PLACEMENT',
    quantity: input.quantity,
    occurredOn: input.arrivalDate,
    notes: input.supplierName ? `From ${input.supplierName}` : null,
    sourceType: 'placement',
  });

  if (firstStage) {
    await recordAnimalGroupEvent(principal, {
      animalGroupId: flockId,
      type: 'STAGE_CHANGE',
      quantity: 0,
      occurredOn: input.arrivalDate,
      toStageId: firstStage.id,
      notes: `Entered ${firstStage.name}`,
    });
  }

  if (input.deadOnArrival > 0) {
    await recordAnimalGroupEvent(principal, {
      animalGroupId: flockId,
      type: 'MORTALITY',
      quantity: input.deadOnArrival,
      occurredOn: input.arrivalDate,
      reasonCode: 'doa',
      notes: 'Dead on arrival',
      sourceType: 'placement',
    });
  }

  await recordAudit({
    principal,
    action: 'population.adjust',
    entityType: 'AnimalGroup',
    entityId: flockId,
    after: {
      code: input.code,
      placed: input.quantity,
      deadOnArrival: input.deadOnArrival,
      dateOfHatch: input.dateOfHatch.toISOString().slice(0, 10),
    },
  });

  revalidatePath('/flocks');
  redirect(`/flocks/${flockId}`);
}

/** Record mortality, a cull, a sale, a transfer out, or a correction. */
export async function recordFlockEvent(
  flockId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const principal = await requirePermission('dailyRecord:create');

  const flock = await db.animalGroup.findFirst({
    where: { id: flockId, site: { ...orgFilter(principal) } },
    select: { id: true, siteId: true, code: true },
  });
  if (!flock) return { error: 'That flock no longer exists.' };
  if (!canAccessSite(principal, flock.siteId)) {
    throw new AuthorizationError('dailyRecord:create', flock.siteId);
  }

  const parsed = flockEventSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const input = parsed.data;

  // Direction belongs to the event type. Only a correction may be negative.
  if (input.type !== 'ADJUSTMENT' && input.quantity < 0) {
    return { fieldErrors: { quantity: 'Enter a positive number — the event type sets the direction.' } };
  }
  if (input.reasonCode && !isValidReason(input.reasonCode, input.type)) {
    return { fieldErrors: { reasonCode: 'That reason does not apply to this kind of event.' } };
  }
  if (input.type === 'ADJUSTMENT' && !input.reasonCode) {
    return { fieldErrors: { reasonCode: 'A correction must say why.' } };
  }

  try {
    const result = await recordAnimalGroupEvent(principal, {
      animalGroupId: flockId,
      type: input.type,
      quantity: input.quantity,
      occurredOn: input.occurredOn,
      reasonCode: input.reasonCode ?? null,
      notes: input.notes ?? null,
      sourceType: 'manual',
    });

    await recordAudit({
      principal,
      action: input.type === 'ADJUSTMENT' ? 'population.adjust' : 'record.correct',
      entityType: 'AnimalGroupEvent',
      entityId: result.id,
      after: {
        flock: flock.code,
        type: input.type,
        quantity: input.quantity,
        reasonCode: input.reasonCode ?? null,
        populationAfter: result.population,
      },
    });
  } catch (error) {
    if (error instanceof FlockError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/flocks/${flockId}`);
  revalidatePath('/flocks');
  return {};
}

/** Move a flock to the next lifecycle stage. */
export async function changeStage(
  flockId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const principal = await requirePermission('flock:edit');

  const flock = await db.animalGroup.findFirst({
    where: { id: flockId, site: { ...orgFilter(principal) } },
    select: { id: true, siteId: true, code: true, productionTypeProfileId: true },
  });
  if (!flock) return { error: 'That flock no longer exists.' };
  if (!canAccessSite(principal, flock.siteId)) {
    throw new AuthorizationError('flock:edit', flock.siteId);
  }

  const parsed = stageChangeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const stage = await db.lifecycleStage.findFirst({
    where: { id: parsed.data.toStageId, productionTypeProfileId: flock.productionTypeProfileId },
    select: { id: true, name: true },
  });
  if (!stage) return { fieldErrors: { toStageId: 'That stage does not apply to this flock.' } };

  await recordAnimalGroupEvent(principal, {
    animalGroupId: flockId,
    type: 'STAGE_CHANGE',
    quantity: 0,
    occurredOn: parsed.data.occurredOn,
    toStageId: stage.id,
    notes: parsed.data.notes ?? `Entered ${stage.name}`,
  });

  await recordAudit({
    principal,
    action: 'record.correct',
    entityType: 'AnimalGroup',
    entityId: flockId,
    after: { flock: flock.code, stage: stage.name },
  });

  revalidatePath(`/flocks/${flockId}`);
  return {};
}
