import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, siteFilter, siteIdFilter, canAccessSite } from '@/lib/scope';
import { fromCedis, type Pesewas } from '@/lib/money';
import {
  orderNumberFor,
  sequenceOf,
  linesAreEditable,
  orderTotal,
  fulfilmentOf,
  fulfilmentSentence,
  orderTiming,
  timingSentence,
  suggestedDelivery,
  type OrderLine,
  type OrderState,
  type Fulfilment,
  type OrderTiming,
} from '@/lib/purchasing';
import type { OrderHeaderInput, OrderLineInput } from '@/lib/validation/purchasing';

/**
 * Purchase orders — ADRAH Farms
 *
 * THE ONLY PLACE A PurchaseOrder OR PurchaseOrderLine IS WRITTEN.
 *
 * The arithmetic lives in `purchasing.ts` and is tested without a database.
 * This file is the part that has to be careful about scope, state and history:
 *
 *   - Every query carries the site restriction IN the where clause.
 *   - An order is CANCELLED, never deleted. "We ordered feed and cancelled it"
 *     is a fact about the farm's week.
 *   - Once SENT, lines are frozen. They are the record of what the supplier was
 *     asked for, and editing them turns "they short-delivered us" into "our own
 *     record says they delivered exactly what we asked for".
 */

/** How each dimension reads in a sentence, so an error can say what went wrong. */
const DIMENSION_WORD: Record<string, string> = {
  COUNT: 'the piece',
  MASS: 'weight',
  VOLUME: 'volume',
};

export class OrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderError';
  }
}

// ---------------------------------------------------------------------------
// READING
// ---------------------------------------------------------------------------

export interface OrderLineRow extends OrderLine {
  id: string;
  notes: string | null;
  /** Expected cost of this line, in pesewas. Null when no price was agreed. */
  lineTotalPesewas: number | null;
}

export interface OrderRow {
  id: string;
  orderNumber: string;
  state: OrderState;
  supplierId: string;
  supplierName: string;
  supplierPhone: string | null;
  siteId: string;
  siteName: string;
  orderedOn: Date;
  expectedOn: Date | null;
  sentAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  notes: string | null;
  placedByName: string;
  lines: OrderLineRow[];
  totalPesewas: Pesewas;
  /** Null when any line has no agreed price — see `totalIsPartial`. */
  totalIsPartial: boolean;
  fulfilment: Fulfilment;
  fulfilmentSentence: string;
  timing: OrderTiming;
  timingSentence: string;
  linesEditable: boolean;
}

type DbOrder = Awaited<ReturnType<typeof findOrders>>[number];

function findOrders(where: object) {
  return db.purchaseOrder.findMany({
    where,
    orderBy: [{ orderedOn: 'desc' }, { orderNumber: 'desc' }],
    include: {
      supplier: { select: { id: true, name: true, phone: true } },
      site: { select: { id: true, name: true } },
      placedBy: { select: { name: true } },
      lines: {
        orderBy: { createdAt: 'asc' },
        include: {
          item: { select: { id: true, name: true } },
          orderUom: { select: { key: true } },
        },
      },
    },
  });
}

/**
 * Turn a database row into something the screens can render.
 *
 * `quantityReceived` IS ZERO HERE, deliberately and temporarily. Receipts are
 * matched against order lines at Task 11.4; until that exists, reporting a
 * guess would be worse than reporting nothing. Every derived figure below
 * already flows from this field, so the screens do not change when it becomes
 * real.
 */
function toRow(order: DbOrder, asOf: Date): OrderRow {
  const lines: OrderLineRow[] = order.lines.map((l) => ({
    id: l.id,
    itemId: l.itemId,
    itemName: l.item.name,
    quantityOrdered: l.quantityOrdered,
    unitKey: l.orderUom.key,
    unitPricePesewas: l.unitPricePesewas ?? 0,
    quantityReceived: 0,
    notes: l.notes,
    lineTotalPesewas:
      l.unitPricePesewas === null ? null : Math.round(l.unitPricePesewas * l.quantityOrdered),
  }));

  // Lines with no agreed price contribute nothing rather than a guess, and the
  // screen says the total is incomplete instead of presenting it as the bill.
  const priced = lines.filter((l) => l.lineTotalPesewas !== null);
  const timing = orderTiming(order.expectedOn, asOf);

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    state: order.state,
    supplierId: order.supplier.id,
    supplierName: order.supplier.name,
    supplierPhone: order.supplier.phone,
    siteId: order.site.id,
    siteName: order.site.name,
    orderedOn: order.orderedOn,
    expectedOn: order.expectedOn,
    sentAt: order.sentAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    notes: order.notes,
    placedByName: order.placedBy.name,
    lines,
    totalPesewas: orderTotal(priced),
    totalIsPartial: priced.length !== lines.length,
    fulfilment: fulfilmentOf(lines),
    fulfilmentSentence: fulfilmentSentence(lines),
    timing,
    timingSentence: timingSentence(timing),
    linesEditable: linesAreEditable(order.state),
  };
}

export async function listOrders(
  principal: Principal,
  options: { state?: OrderState; asOf?: Date } = {},
): Promise<OrderRow[]> {
  const asOf = options.asOf ?? new Date();
  const orders = await findOrders({
    ...orgFilter(principal),
    ...siteFilter(principal),
    ...(options.state ? { state: options.state } : {}),
  });
  return orders.map((o) => toRow(o, asOf));
}

export async function orderById(
  principal: Principal,
  orderId: string,
  asOf: Date = new Date(),
): Promise<OrderRow | null> {
  const orders = await findOrders({
    id: orderId,
    ...orgFilter(principal),
    ...siteFilter(principal),
  });
  return orders[0] ? toRow(orders[0], asOf) : null;
}

/**
 * Everything the "place an order" form needs.
 *
 * The suppliers come back with their own lead times so the form can SUGGEST a
 * delivery date the moment one is chosen — a suggestion in a field somebody can
 * change, never a promise made on the supplier's behalf.
 */
export async function orderContext(principal: Principal) {
  const [sites, suppliers, items, units, org] = await Promise.all([
    db.site.findMany({
      where: { ...orgFilter(principal), ...siteIdFilter(principal), isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    db.supplier.findMany({
      where: { ...orgFilter(principal), isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, leadTimeDays: true, supplies: true },
    }),
    db.item.findMany({
      where: { ...orgFilter(principal), isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: { stockUom: { select: { key: true, name: true, dimension: true } } },
    }),
    db.unitOfMeasure.findMany({ orderBy: [{ dimension: 'asc' }, { factorToBase: 'asc' }] }),
    db.organisation.findUnique({
      where: { id: principal.organisationId },
      select: { stockLeadTimeDays: true },
    }),
  ]);

  const farmLeadTimeDays = org?.stockLeadTimeDays ?? 7;

  return {
    sites,
    suppliers: suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      supplies: s.supplies as string[],
      // The supplier's own figure when it has one, the farm's otherwise.
      effectiveLeadTimeDays: s.leadTimeDays ?? farmLeadTimeDays,
      usingFarmDefault: s.leadTimeDays === null,
    })),
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      sku: i.sku,
      category: i.category as string,
      /** What this item is normally counted in — the default, not a restriction. */
      unitKey: i.stockUom.key,
      dimension: i.stockUom.dimension as string,
    })),
    units: units.map((u) => ({
      key: u.key,
      name: u.name,
      dimension: u.dimension as string,
    })),
    farmLeadTimeDays,
  };
}

/** The date the form offers, given a supplier. Exported so the screen and the tests agree. */
export function suggestedFor(orderedOn: Date, leadTimeDays: number | null): Date | null {
  return suggestedDelivery(orderedOn, leadTimeDays);
}

// ---------------------------------------------------------------------------
// WRITING
// ---------------------------------------------------------------------------

/**
 * The next order number for this organisation, this year.
 *
 * Counted from the highest number already used rather than from a row count,
 * because a count would reuse a number the moment anything is ever removed —
 * and two orders sharing a reference is exactly the failure that makes a
 * supplier dispute unresolvable. The unique index is the real guard; this is
 * how the common case avoids hitting it.
 */
async function nextOrderNumber(organisationId: string, year: number): Promise<string> {
  const latest = await db.purchaseOrder.findFirst({
    where: { organisationId, orderNumber: { startsWith: `PO-${year}-` } },
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true },
  });
  return orderNumberFor(year, sequenceOf(latest?.orderNumber ?? '', year) + 1);
}

export async function createOrder(
  principal: Principal,
  input: OrderHeaderInput,
): Promise<{ id: string; orderNumber: string }> {
  // Scope is checked before anything is written, not after. A site the user
  // cannot reach does not exist as far as they are concerned.
  if (!canAccessSite(principal, input.siteId)) {
    throw new OrderError('That farm is not one you have access to.');
  }

  const supplier = await db.supplier.findFirst({
    where: { id: input.supplierId, ...orgFilter(principal) },
    select: { id: true, isActive: true, name: true },
  });
  if (!supplier) throw new OrderError('That supplier no longer exists.');
  if (!supplier.isActive) {
    throw new OrderError(
      `${supplier.name} is archived. Restore them first if the farm is buying from them again.`,
    );
  }

  const year = input.orderedOn.getUTCFullYear();

  // Two people placing an order in the same second would collide on the unique
  // index. A farm places a handful of orders a week, so retrying is cheaper and
  // simpler than a dedicated sequence table.
  for (let attempt = 0; attempt < 5; attempt++) {
    const orderNumber = await nextOrderNumber(principal.organisationId, year);
    try {
      const created = await db.purchaseOrder.create({
        data: {
          organisationId: principal.organisationId,
          siteId: input.siteId,
          supplierId: input.supplierId,
          orderNumber,
          state: 'DRAFT',
          orderedOn: input.orderedOn,
          expectedOn: input.expectedOn,
          notes: input.notes,
          placedById: principal.userId,
        },
        select: { id: true, orderNumber: true },
      });
      return created;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'P2002' || attempt === 4) throw error;
    }
  }
  throw new OrderError('Could not allocate an order number. Try again.');
}

/** Fetch an order for writing, with scope applied. Throws rather than returning null. */
async function orderForWrite(principal: Principal, orderId: string) {
  const order = await db.purchaseOrder.findFirst({
    where: { id: orderId, ...orgFilter(principal), ...siteFilter(principal) },
    select: { id: true, state: true, orderNumber: true, siteId: true },
  });
  if (!order) throw new OrderError('That order no longer exists.');
  return order;
}

export async function addOrderLine(
  principal: Principal,
  orderId: string,
  input: OrderLineInput,
): Promise<void> {
  const order = await orderForWrite(principal, orderId);
  if (!linesAreEditable(order.state)) {
    throw new OrderError(
      order.state === 'SENT'
        ? 'This order has been sent. Cancel it and place a new one rather than changing what the supplier was told.'
        : 'This order was cancelled. Its lines are kept as they were.',
    );
  }

  const item = await db.item.findFirst({
    where: { id: input.itemId, ...orgFilter(principal) },
    select: { id: true, name: true, stockUom: { select: { dimension: true } } },
  });
  if (!item) throw new OrderError('That item no longer exists.');

  const unit = await db.unitOfMeasure.findUnique({
    where: { key: input.orderUomKey },
    select: { id: true, key: true, dimension: true },
  });
  if (!unit) throw new OrderError('That unit is not one this system knows.');

  // A quantity in litres against an item counted in kilograms cannot be
  // converted, and a receipt would later have to guess. Refused, not warned.
  if (unit.dimension !== item.stockUom.dimension) {
    throw new OrderError(
      `${item.name} is counted by ${DIMENSION_WORD[item.stockUom.dimension]}, and ${unit.key} ` +
        `measures ${DIMENSION_WORD[unit.dimension]}. A delivery in one could not be matched ` +
        'against an order in the other.',
    );
  }

  const existing = await db.purchaseOrderLine.findFirst({
    where: { purchaseOrderId: order.id, itemId: item.id },
    select: { id: true },
  });
  if (existing) {
    throw new OrderError(
      `${item.name} is already on this order. Change that line rather than adding a second one — ` +
        'two lines for one item make every outstanding figure ambiguous.',
    );
  }

  await db.purchaseOrderLine.create({
    data: {
      purchaseOrderId: order.id,
      itemId: item.id,
      quantityOrdered: input.quantityOrdered,
      orderUomId: unit.id,
      unitPricePesewas:
        input.unitPriceCedis === null ? null : (fromCedis(input.unitPriceCedis) as number),
      notes: input.notes,
    },
  });
}

export async function removeOrderLine(
  principal: Principal,
  orderId: string,
  lineId: string,
): Promise<string> {
  const order = await orderForWrite(principal, orderId);
  if (!linesAreEditable(order.state)) {
    throw new OrderError('Only a draft order can have lines removed.');
  }

  const line = await db.purchaseOrderLine.findFirst({
    where: { id: lineId, purchaseOrderId: order.id },
    include: { item: { select: { name: true } } },
  });
  if (!line) throw new OrderError('That line is already gone.');

  // A DRAFT is a working document nobody has been shown, so a line removed from
  // one is a correction rather than a deleted record. Once the order is sent,
  // the branch above makes this unreachable.
  await db.purchaseOrderLine.delete({ where: { id: line.id } });
  return line.item.name;
}

export async function updateOrderHeader(
  principal: Principal,
  orderId: string,
  input: OrderHeaderInput,
): Promise<void> {
  const order = await orderForWrite(principal, orderId);
  if (order.state === 'CANCELLED') {
    throw new OrderError('A cancelled order is kept as it was.');
  }
  if (!canAccessSite(principal, input.siteId)) {
    throw new OrderError('That farm is not one you have access to.');
  }

  // THE SUPPLIER AND THE SITE ARE NOT CHANGED after sending. The order number
  // has been quoted to a particular supplier by then; pointing it at another
  // one would leave that supplier holding a reference for an order that,
  // according to this system, was always somebody else's.
  const movable = order.state === 'DRAFT';

  await db.purchaseOrder.update({
    where: { id: order.id },
    data: {
      ...(movable ? { siteId: input.siteId, supplierId: input.supplierId } : {}),
      orderedOn: input.orderedOn,
      expectedOn: input.expectedOn,
      notes: input.notes,
    },
  });
}

/** Mark an order as sent. Stamps who and when, rather than leaving it to the state alone. */
export async function markOrderSent(
  principal: Principal,
  orderId: string,
): Promise<{ orderNumber: string }> {
  const order = await orderForWrite(principal, orderId);
  if (order.state === 'SENT') throw new OrderError('This order has already been sent.');
  if (order.state === 'CANCELLED') {
    throw new OrderError('This order was cancelled. Place a new one instead.');
  }

  const lineCount = await db.purchaseOrderLine.count({ where: { purchaseOrderId: order.id } });
  if (lineCount === 0) {
    throw new OrderError('An order with no lines has nothing to send. Add what you are buying.');
  }

  await db.purchaseOrder.update({
    where: { id: order.id },
    data: { state: 'SENT', sentAt: new Date(), sentById: principal.userId },
  });
  return { orderNumber: order.orderNumber };
}

/**
 * Cancel an order.
 *
 * NOT A DELETE. The order stays, its lines stay, and the reason is stored on
 * it. Goods sometimes turn up against a cancelled order anyway, and the
 * receiving screen needs to be able to say so rather than finding nothing.
 */
export async function cancelOrder(
  principal: Principal,
  orderId: string,
  reason: string,
): Promise<{ orderNumber: string }> {
  const order = await orderForWrite(principal, orderId);
  if (order.state === 'CANCELLED') throw new OrderError('This order is already cancelled.');

  await db.purchaseOrder.update({
    where: { id: order.id },
    data: {
      state: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledById: principal.userId,
      cancelReason: reason,
    },
  });
  return { orderNumber: order.orderNumber };
}
