import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, siteFilter, siteIdFilter } from '@/lib/scope';
import { fromBase } from '@/lib/uom';
import { recordStockMovement, StockMovementError } from '@/lib/stock-movements';
import { checkReceipt, suggestBatchNumber } from '@/lib/receiving';
import { currentUnitCost } from '@/lib/receipt-service';
import { warningToken, type Warning } from '@/lib/warnings';
import { recordAudit } from '@/lib/audit';
import { fromCedis } from '@/lib/money';
import {
  checkReceiptAgainstOrder,
  outstandingOf,
  type OrderLine,
  type OrderState,
} from '@/lib/purchasing';
import { RECEIPT_SOURCE_TYPE, OrderError } from '@/lib/order-service';
import type { OrderReceiptInput } from '@/lib/validation/purchasing';

/**
 * Receiving against an order — ADRAH Farms
 *
 * The point where an expectation meets a fact.
 *
 * WHAT THIS DOES NOT DO: it does not update the order. The order keeps saying
 * twenty bags at GHS 260 forever, because that is what was agreed. What
 * arrived lives in the stock ledger, tagged with the line it came in against,
 * and the gap between the two is read back by `order-service`. Neither number
 * is allowed to overwrite the other.
 *
 * WARN, NEVER BLOCK. Twenty-one bags arrived; refusing to record the
 * twenty-first does not send it back, it just means the store is wrong by one
 * bag and nobody knows why. Every check here produces a warning that must be
 * acknowledged by a token bound to those exact warnings — see warnings.ts.
 */

export type OrderReceiptResult =
  | {
      status: 'saved';
      movementId: string;
      itemName: string;
      /** In the unit the LINE was ordered in, not the item's display unit. */
      quantity: number;
      unitKey: string;
      batchNumber: string | null;
      /** What is still outstanding on that line after this delivery. */
      stillOutstanding: number;
      orderComplete: boolean;
    }
  | { status: 'needsConfirmation'; warnings: Warning[]; token: string }
  | { status: 'error'; message: string };

export interface ReceivableLine {
  id: string;
  itemId: string;
  itemName: string;
  /** The item's own counting unit, shown so the two are never confused. */
  itemUnitKey: string;
  quantityOrdered: number;
  unitKey: string;
  quantityReceived: number;
  outstanding: number;
  unitPricePesewas: number | null;
  isPerishable: boolean;
  suggestedBatchNumber: string;
}

export interface ReceiveContext {
  orderId: string;
  orderNumber: string;
  state: OrderState;
  supplierName: string;
  siteName: string;
  lines: ReceivableLine[];
  locations: { id: string; name: string; siteName: string }[];
}

/**
 * Everything the receiving screen needs.
 *
 * The stores offered are the ones at the order's OWN site. A delivery for the
 * main farm that is booked into a store at another farm is stock in the wrong
 * building, and no later report can tell that it happened.
 */
export async function receiveContext(
  principal: Principal,
  orderId: string,
  on: Date,
): Promise<ReceiveContext | null> {
  const order = await db.purchaseOrder.findFirst({
    where: { id: orderId, ...orgFilter(principal), ...siteFilter(principal) },
    include: {
      supplier: { select: { name: true } },
      site: { select: { id: true, name: true } },
      lines: {
        orderBy: { createdAt: 'asc' },
        include: {
          item: { select: { id: true, name: true, sku: true, isPerishable: true, stockUom: { select: { key: true } } } },
          orderUom: { select: { key: true } },
        },
      },
    },
  });
  if (!order) return null;

  const lineIds = order.lines.map((l) => l.id);
  const sums =
    lineIds.length === 0
      ? []
      : await db.stockMovement.groupBy({
          by: ['sourceId'],
          where: { sourceType: RECEIPT_SOURCE_TYPE, sourceId: { in: lineIds } },
          _sum: { deltaBase: true },
        });
  const receivedBase = new Map(sums.map((s) => [s.sourceId, s._sum.deltaBase ?? 0]));

  const locations = await db.stockLocation.findMany({
    where: {
      siteId: order.site.id,
      isActive: true,
      site: { ...orgFilter(principal), ...siteIdFilter(principal) },
    },
    orderBy: { name: 'asc' },
    include: { site: { select: { name: true } } },
  });

  const sameDayCounts = new Map<string, number>();
  for (const line of order.lines) {
    if (sameDayCounts.has(line.itemId)) continue;
    sameDayCounts.set(
      line.itemId,
      await db.itemBatch.count({ where: { itemId: line.itemId, receivedOn: on } }),
    );
  }

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    state: order.state,
    supplierName: order.supplier.name,
    siteName: order.site.name,
    lines: order.lines.map((l) => {
      // Base units back into the ORDERED unit — twenty bags of fifty is a
      // thousand kilograms, and the two must never be compared directly.
      const received = round(fromBase(receivedBase.get(l.id) ?? 0, l.orderUom.key));
      return {
        id: l.id,
        itemId: l.itemId,
        itemName: l.item.name,
        itemUnitKey: l.item.stockUom.key,
        quantityOrdered: l.quantityOrdered,
        unitKey: l.orderUom.key,
        quantityReceived: received,
        outstanding: Math.max(0, round(l.quantityOrdered - received)),
        unitPricePesewas: l.unitPricePesewas,
        isPerishable: l.item.isPerishable,
        suggestedBatchNumber: suggestBatchNumber(
          l.item.sku,
          on,
          sameDayCounts.get(l.itemId) ?? 0,
        ),
      };
    }),
    locations: locations.map((l) => ({ id: l.id, name: l.name, siteName: l.site.name })),
  };
}

export async function receiveAgainstOrder(
  principal: Principal,
  orderId: string,
  input: OrderReceiptInput,
): Promise<OrderReceiptResult> {
  const order = await db.purchaseOrder.findFirst({
    where: { id: orderId, ...orgFilter(principal), ...siteFilter(principal) },
    select: { id: true, state: true, orderNumber: true, siteId: true },
  });
  if (!order) return { status: 'error', message: 'That order no longer exists.' };

  const line = await db.purchaseOrderLine.findFirst({
    where: { id: input.lineId, purchaseOrderId: order.id },
    include: {
      item: { select: { id: true, name: true, sku: true, isPerishable: true } },
      orderUom: { select: { key: true } },
    },
  });
  if (!line) return { status: 'error', message: 'That line is not on this order.' };

  // The store must belong to the order's own site.
  const location = await db.stockLocation.findFirst({
    where: {
      id: input.stockLocationId,
      siteId: order.siteId,
      site: { ...orgFilter(principal) },
    },
    select: { id: true },
  });
  if (!location) {
    return {
      status: 'error',
      message: 'That store is not at the farm this order is being delivered to.',
    };
  }

  const receivedBase = await db.stockMovement.aggregate({
    where: { sourceType: RECEIPT_SOURCE_TYPE, sourceId: line.id },
    _sum: { deltaBase: true },
  });
  const alreadyReceived = round(
    fromBase(receivedBase._sum.deltaBase ?? 0, line.orderUom.key),
  );

  const asOrderLine: OrderLine = {
    itemId: line.itemId,
    itemName: line.item.name,
    quantityOrdered: line.quantityOrdered,
    unitKey: line.orderUom.key,
    unitPricePesewas: line.unitPricePesewas ?? 0,
    quantityReceived: alreadyReceived,
  };

  // TWO SETS OF CHECKS, shown together.
  //
  //   Against the ORDER: over-delivery, a price that moved, receiving against a
  //   draft or a cancelled order.
  //   Against the STOCK: a missing expiry on a perishable, a price a quarter
  //   away from what is already on hand.
  //
  // They answer different questions and a person signing a delivery note wants
  // both on one screen, not one after the other.
  const orderWarnings = checkReceiptAgainstOrder({
    orderState: order.state,
    line: asOrderLine,
    quantityNow: input.quantity,
    unitPricePesewas:
      input.priceCedis === null ? null : (fromCedis(input.priceCedis) as number),
  });

  const stockWarnings = checkReceipt({
    quantityEntered: input.quantity,
    priceCedis: input.priceCedis,
    unitKey: line.orderUom.key,
    expiresOn: input.expiresOn,
    occurredOn: input.occurredOn,
    isPerishable: line.item.isPerishable,
    previousUnitCostPesewas: await currentUnitCost(line.itemId),
  });

  const warnings: Warning[] = [
    ...orderWarnings.map((w) => ({ field: w.field, message: w.message })),
    ...stockWarnings,
  ];

  if (warnings.length > 0) {
    const token = warningToken(warnings);
    // Only an acknowledgement of THESE warnings counts. Change the quantity and
    // the token changes with it, so a tick from a moment ago cannot wave
    // through a figure nobody has seen.
    if (input.acknowledgedToken !== token) {
      return { status: 'needsConfirmation', warnings, token };
    }
  }

  const batchNumber =
    input.batchNumber ??
    suggestBatchNumber(
      line.item.sku,
      input.occurredOn,
      await db.itemBatch.count({
        where: { itemId: line.itemId, receivedOn: input.occurredOn },
      }),
    );

  try {
    const movement = await recordStockMovement(principal, {
      itemId: line.itemId,
      stockLocationId: location.id,
      type: 'PURCHASE_RECEIPT',
      // Entered in the ORDERED unit. `recordStockMovement` converts to base;
      // passing the item's display unit here is the factor-of-fifty bug.
      quantityEntered: input.quantity,
      enteredUomKey: line.orderUom.key,
      occurredOn: input.occurredOn,
      batchNumber,
      expiresOn: input.expiresOn,
      // THE INVOICED PRICE, not the agreed one. See the note on the schema.
      priceCedis: input.priceCedis,
      notes: joinNotes(order.orderNumber, input.reference, input.notes),
      sourceType: RECEIPT_SOURCE_TYPE,
      sourceId: line.id,
    });

    await recordAudit({
      principal,
      action: 'order.receive',
      entityType: 'PurchaseOrder',
      entityId: order.id,
      after: {
        line: line.id,
        item: line.item.sku,
        quantity: input.quantity,
        unit: line.orderUom.key,
        batch: movement.batchNumber,
        orderedUnitPricePesewas: line.unitPricePesewas,
        invoicedUnitPriceCedis: input.priceCedis,
        acknowledgedWarnings: warnings.map((w) => w.message),
      },
    });

    const nowReceived = round(alreadyReceived + input.quantity);
    const stillOutstanding = outstandingOf({ ...asOrderLine, quantityReceived: nowReceived });

    return {
      status: 'saved',
      movementId: movement.id,
      itemName: line.item.name,
      quantity: input.quantity,
      unitKey: line.orderUom.key,
      batchNumber: movement.batchNumber,
      stillOutstanding,
      orderComplete: await isOrderComplete(order.id),
    };
  } catch (error) {
    if (error instanceof StockMovementError || error instanceof OrderError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }
}

/** Whether every line on the order is now covered. Derived, never stored. */
async function isOrderComplete(orderId: string): Promise<boolean> {
  const lines = await db.purchaseOrderLine.findMany({
    where: { purchaseOrderId: orderId },
    include: { orderUom: { select: { key: true } } },
  });
  if (lines.length === 0) return false;

  const sums = await db.stockMovement.groupBy({
    by: ['sourceId'],
    where: { sourceType: RECEIPT_SOURCE_TYPE, sourceId: { in: lines.map((l) => l.id) } },
    _sum: { deltaBase: true },
  });
  const received = new Map(sums.map((s) => [s.sourceId, s._sum.deltaBase ?? 0]));

  return lines.every(
    (l) => round(fromBase(received.get(l.id) ?? 0, l.orderUom.key)) >= l.quantityOrdered,
  );
}

/** The order number first, because that is what somebody searches for. */
function joinNotes(
  orderNumber: string,
  reference: string | null,
  notes: string | null,
): string {
  return [orderNumber, reference, notes].filter((p): p is string => Boolean(p)).join(' — ');
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
