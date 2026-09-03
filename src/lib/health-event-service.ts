import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter } from '@/lib/scope';
import { ageInDays } from '@/lib/metrics';
import { issueFromStock, StockMovementError } from '@/lib/stock-movements';
import { checkHealthEvent } from '@/lib/health-checks';
import { warningToken, type Warning } from '@/lib/warnings';
import { BASE_UNIT, type Dimension } from '@/lib/uom';
import type { HealthEventInput } from '@/lib/validation/health';

/**
 * Recording what was actually given — ADRAH Farms
 *
 * One transaction: the health event, the stock that left the store, and the cost
 * charged to the flock. A vaccination recorded with no matching stock movement
 * is the same disagreement the ledger exists to prevent, one category along.
 *
 * WHAT THIS DOES NOT DO is decide anything clinical. The name, the dose, the
 * route and the withdrawal period all arrive from the person recording it —
 * prefilled from the programme where there is one, and editable in every case,
 * because the product actually used is not always the product planned.
 */

export type RecordEventResult =
  | {
      status: 'saved';
      eventId: string;
      issuedBase: number;
      shortfallBase: number;
      costPesewas: number;
      batchNumbers: string[];
    }
  | { status: 'needsConfirmation'; warnings: Warning[]; token: string }
  | { status: 'error'; message: string };

export async function recordHealthEvent(
  principal: Principal,
  flockId: string,
  input: HealthEventInput,
): Promise<RecordEventResult> {
  const flock = await db.animalGroup.findFirst({
    where: { id: flockId, site: orgFilter(principal) },
    select: { id: true, code: true, dateOfHatch: true, siteId: true },
  });
  if (!flock) return { status: 'error', message: 'That flock no longer exists.' };

  const populationRow = await db.animalGroupEvent.aggregate({
    where: { animalGroupId: flockId },
    _sum: { delta: true },
  });
  const population = populationRow._sum.delta ?? 0;

  // --- what it would draw from the store -----------------------------------
  let item: { id: string; name: string; dimension: Dimension } | null = null;
  let store: { id: string; name: string } | null = null;
  let availableBase: number | null = null;

  if (input.itemId && input.stockLocationId && input.quantityBase) {
    const found = await db.item.findFirst({
      where: { id: input.itemId, ...orgFilter(principal) },
      include: { stockUom: true },
    });
    const location = await db.stockLocation.findFirst({
      where: { id: input.stockLocationId, site: orgFilter(principal) },
      select: { id: true, name: true },
    });
    if (!found || !location) {
      return { status: 'error', message: 'That item or store is no longer available.' };
    }
    item = { id: found.id, name: found.name, dimension: found.stockUom.dimension as Dimension };
    store = location;

    const onHand = await db.stockMovement.aggregate({
      where: { itemId: found.id, stockLocationId: location.id },
      _sum: { deltaBase: true },
    });
    availableBase = onHand._sum.deltaBase ?? 0;
  }

  // --- warn, then confirm ---------------------------------------------------
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const ageDays = ageInDays(flock.dateOfHatch, input.occurredOn);

  const warnings = checkHealthEvent({
    birdsTreated: input.birdsTreated,
    population,
    occurredOn: input.occurredOn,
    today: todayUtc,
    ageDays,
    eventType: input.type,
    eggWithdrawalDays: input.eggWithdrawalDays,
    meatWithdrawalDays: input.meatWithdrawalDays,
    requiredBase: item ? input.quantityBase : null,
    availableBase,
    itemName: item?.name ?? null,
    storeName: store?.name ?? null,
  });

  if (warnings.length > 0) {
    const token = warningToken(warnings);
    if (input.acknowledgedToken !== token) {
      return { status: 'needsConfirmation', warnings, token };
    }
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const event = await tx.healthEvent.create({
        data: {
          animalGroupId: flockId,
          programmeItemId: input.programmeItemId,
          type: input.type,
          name: input.name,
          occurredOn: input.occurredOn,
          ageDays,
          route: input.route,
          birdsTreated: input.birdsTreated,
          itemId: item?.id ?? null,
          quantityBase: item ? input.quantityBase : null,
          eggWithdrawalDays: input.eggWithdrawalDays,
          meatWithdrawalDays: input.meatWithdrawalDays,
          administeredBy: input.administeredBy,
          vetName: input.vetName,
          diagnosis: input.diagnosis,
          notes: input.notes,
          recordedById: principal.userId,
        },
        select: { id: true },
      });

      if (!item || !store || !input.quantityBase) {
        return {
          eventId: event.id,
          issuedBase: 0,
          shortfallBase: 0,
          costPesewas: 0,
          batchNumbers: [] as string[],
        };
      }

      const issued = await issueFromStock(tx, principal, {
        itemId: item.id,
        stockLocationId: store.id,
        quantityBase: input.quantityBase,
        unitKey: BASE_UNIT[item.dimension],
        occurredOn: input.occurredOn,
        notes: `${input.name} — ${flock.code}`,
        sourceType: 'healthEvent',
        sourceId: event.id,
      });

      // The batch a dose came out of matters more here than anywhere else: if a
      // vaccine batch is later recalled, this is what says which birds got it.
      if (issued.movementIds.length > 0) {
        const firstMovement = await tx.stockMovement.findUnique({
          where: { id: issued.movementIds[0] },
          select: { itemBatchId: true },
        });
        await tx.healthEvent.update({
          where: { id: event.id },
          data: { itemBatchId: firstMovement?.itemBatchId ?? null, costPesewas: issued.costPesewas },
        });
      }

      if (issued.costPesewas > 0) {
        await tx.flockCostEntry.create({
          data: {
            animalGroupId: flockId,
            category: 'HEALTH',
            amountPesewas: issued.costPesewas,
            incurredOn: input.occurredOn,
            description: `${input.name} — ${issued.issuedBase} ${BASE_UNIT[item.dimension]}`,
            sourceType: 'healthEvent',
            sourceId: event.id,
            recordedById: principal.userId,
          },
        });
      }

      return { eventId: event.id, ...issued };
    });

    return {
      status: 'saved',
      eventId: result.eventId,
      issuedBase: result.issuedBase,
      shortfallBase: result.shortfallBase,
      costPesewas: result.costPesewas,
      batchNumbers: result.batchNumbers,
    };
  } catch (error) {
    if (error instanceof StockMovementError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

/** Everything recorded for one flock, newest first. */
export async function healthEventsFor(principal: Principal, flockId: string, take = 50) {
  return db.healthEvent.findMany({
    where: { animalGroupId: flockId, animalGroup: { site: orgFilter(principal) } },
    orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
    take,
    include: {
      item: { select: { name: true } },
      itemBatch: { select: { batchNumber: true } },
      recordedBy: { select: { name: true } },
      programmeItem: { select: { name: true, ageDays: true } },
    },
  });
}

/** What a recording form needs: the flock, the planned entry, and stock options. */
export async function recordContext(
  principal: Principal,
  flockId: string,
  programmeItemId?: string,
) {
  const flock = await db.animalGroup.findFirst({
    where: { id: flockId, site: orgFilter(principal) },
    select: { id: true, code: true, siteId: true, dateOfHatch: true },
  });
  if (!flock) return null;

  const [populationRow, planned, items, locations] = await Promise.all([
    db.animalGroupEvent.aggregate({
      where: { animalGroupId: flockId },
      _sum: { delta: true },
    }),
    programmeItemId
      ? db.healthProgrammeItem.findFirst({
          where: { id: programmeItemId, programme: orgFilter(principal) },
          include: { item: { select: { id: true, name: true } } },
        })
      : null,
    db.item.findMany({
      where: {
        ...orgFilter(principal),
        isActive: true,
        category: { in: ['VACCINE', 'MEDICINE', 'DISINFECTANT', 'OTHER'] },
      },
      orderBy: { name: 'asc' },
      include: { stockUom: true },
    }),
    db.stockLocation.findMany({
      where: { siteId: flock.siteId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  return {
    flock,
    population: populationRow._sum.delta ?? 0,
    planned,
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      sku: i.sku,
      unitName: i.stockUom.name,
      baseUnit: BASE_UNIT[i.stockUom.dimension as Dimension],
    })),
    locations,
  };
}
