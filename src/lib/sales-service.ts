import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, siteFilter, canAccessSite } from '@/lib/scope';
import { pesewas, type Pesewas } from '@/lib/money';
import {
  orderNumberFor,
  sequenceOf,
  orderTotal,
  lineErrors,
  confirmErrors,
  cancelErrors,
  withdrawalGate,
  type SalesOrder,
  type SalesOrderState,
  type OrderLine,
  type PriceBasis,
  type RestrictedFlock,
  type WithdrawalVerdict,
} from '@/lib/sales';
import { priceFor } from '@/lib/pricing';
import { allPrices } from '@/lib/product-service';
import { withdrawalsAcrossFlocks } from '@/lib/withdrawal-service';

/**
 * Sales order service — ADRAH Farms
 *
 * THE ONLY PLACE A SalesOrder OR SalesOrderLine IS WRITTEN.
 *
 * NOTHING HERE TOUCHES STOCK OR PRODUCTION. Confirming an order is a promise,
 * not a movement — the eggs do not leave the store until somebody dispatches
 * them, and writing a stock movement at confirmation would make the store
 * disagree with the shelf for every order that has not gone out yet. Dispatch is
 * a separate act and a later task.
 *
 * AND NOTHING HERE RECORDS MONEY ARRIVING. See sales.ts.
 */

export class SalesError extends Error {
  constructor(
    message: string,
    /** Set when the refusal is a withdrawal period, so the page can say when. */
    readonly clearsOn: Date | null = null,
  ) {
    super(message);
    this.name = 'SalesError';
  }
}

const include = {
  customer: { select: { id: true, name: true, businessName: true, phone: true } },
  site: { select: { id: true, name: true } },
  drawnFrom: { select: { code: true, productionUnit: { select: { name: true } } } },
  createdBy: { select: { name: true } },
  confirmedBy: { select: { name: true } },
  cancelledBy: { select: { name: true } },
  lines: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      product: { select: { name: true, packLabel: true, unitsPerPack: true } },
    },
  },
} as const;

type DbOrder = Awaited<ReturnType<typeof findOrders>>[number];

function findOrders(where: object) {
  return db.salesOrder.findMany({ where, orderBy: { orderedOn: 'desc' }, include });
}

function toLine(row: DbOrder['lines'][number]): OrderLine {
  return {
    id: row.id,
    productId: row.productId,
    productName: row.product.name,
    packLabel: row.product.packLabel,
    unitsPerPack: row.product.unitsPerPack,
    quantity: row.quantity,
    unitPricePesewas: pesewas(row.unitPricePesewas),
    priceBasis: row.priceBasis as PriceBasis,
    note: row.note,
  };
}

function toOrder(row: DbOrder): SalesOrder {
  const lines = row.lines.map(toLine);
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    state: row.state as SalesOrderState,
    customerId: row.customer.id,
    customerName: row.customer.businessName
      ? `${row.customer.businessName} · ${row.customer.name}`
      : row.customer.name,
    customerPhone: row.customer.phone,
    siteId: row.site.id,
    siteName: row.site.name,
    orderedOn: row.orderedOn,
    wantedOn: row.wantedOn,
    drawnFromFlockId: row.drawnFromFlockId,
    drawnFromFlockName: row.drawnFrom
      ? (row.drawnFrom.productionUnit?.name ?? row.drawnFrom.code)
      : null,
    notes: row.notes,
    lines,
    totalPesewas: orderTotal(lines),
    createdByName: row.createdBy?.name ?? null,
    confirmedAt: row.confirmedAt,
    confirmedByName: row.confirmedBy?.name ?? null,
    cancelledAt: row.cancelledAt,
    cancelledByName: row.cancelledBy?.name ?? null,
    cancelReason: row.cancelReason,
  };
}

export async function listOrders(
  principal: Principal,
  options: { customerId?: string; state?: SalesOrderState } = {},
): Promise<SalesOrder[]> {
  const rows = await findOrders({
    ...orgFilter(principal),
    ...siteFilter(principal),
    ...(options.customerId ? { customerId: options.customerId } : {}),
    ...(options.state ? { state: options.state } : {}),
  });
  return rows.map(toOrder);
}

export async function orderById(
  principal: Principal,
  orderId: string,
): Promise<SalesOrder | null> {
  const row = await db.salesOrder.findFirst({
    where: { id: orderId, ...orgFilter(principal), ...siteFilter(principal) },
    include,
  });
  return row ? toOrder(row as DbOrder) : null;
}

async function nextOrderNumber(organisationId: string, year: number): Promise<string> {
  const latest = await db.salesOrder.findFirst({
    where: { organisationId, orderNumber: { startsWith: `SO-${year}-` } },
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true },
  });
  return orderNumberFor(year, sequenceOf(latest?.orderNumber ?? '', year) + 1);
}

export async function createOrder(
  principal: Principal,
  input: { customerId: string; siteId: string; wantedOn: Date | null; notes: string | null },
): Promise<{ id: string; orderNumber: string }> {
  if (!canAccessSite(principal, input.siteId)) {
    throw new SalesError('That farm is not one you have access to.');
  }

  const customer = await db.customer.findFirst({
    where: { id: input.customerId, ...orgFilter(principal), archivedAt: null },
    select: { id: true },
  });
  if (!customer) throw new SalesError('That buyer is not on the list.');

  const orderedOn = new Date();
  const year = orderedOn.getUTCFullYear();

  // Two people writing an order in the same second would collide on the unique
  // index. Retrying is cheaper than a sequence table at this scale — the same
  // approach as incident references.
  for (let attempt = 0; attempt < 5; attempt++) {
    const orderNumber = await nextOrderNumber(principal.organisationId, year);
    try {
      return await db.salesOrder.create({
        data: {
          organisationId: principal.organisationId,
          siteId: input.siteId,
          customerId: input.customerId,
          orderNumber,
          orderedOn: new Date(
            Date.UTC(orderedOn.getUTCFullYear(), orderedOn.getUTCMonth(), orderedOn.getUTCDate()),
          ),
          wantedOn: input.wantedOn,
          notes: input.notes,
          createdById: principal.userId,
        },
        select: { id: true, orderNumber: true },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002' || attempt === 4) throw error;
    }
  }
  throw new SalesError('Could not allocate an order number. Try again.');
}

/**
 * What this buyer would pay for this product today, and where that came from.
 *
 * USED TO PRE-FILL, NEVER TO DECIDE. The figure is copied onto the line when it
 * is added; changing the price list afterwards does not move it.
 */
export async function suggestedPrice(
  principal: Principal,
  input: { productId: string; customerId: string; on?: Date },
): Promise<{ pricePesewas: Pesewas; basis: PriceBasis } | null> {
  const prices = await allPrices(principal, {
    productId: input.productId,
    customerId: input.customerId,
  });
  const resolved = priceFor(prices, {
    productId: input.productId,
    customerId: input.customerId,
    on: input.on ?? new Date(),
  });
  if (!resolved) return null;
  return {
    pricePesewas: resolved.pricePesewas,
    basis: resolved.isCustomerPrice ? 'AGREED' : 'LIST',
  };
}

export async function addLine(
  principal: Principal,
  orderId: string,
  input: { productId: string; quantity: number; pricePesewas: Pesewas | null; note: string | null },
): Promise<{ id: string }> {
  const order = await orderById(principal, orderId);
  if (!order) throw new SalesError('That order no longer exists.');
  if (order.state !== 'DRAFT') {
    throw new SalesError('Only a draft can be changed. Cancel it and write a new one.');
  }

  const product = await db.product.findFirst({
    where: { id: input.productId, ...orgFilter(principal), isActive: true },
    select: { id: true },
  });
  if (!product) throw new SalesError('That product is not on the list.');

  // A TYPED PRICE WINS, and is recorded as typed. Otherwise the resolved price
  // is used, and which of the two it was is stored — because "why is this line
  // 45 when the list says 50?" is the first question anybody asks.
  let unitPrice = input.pricePesewas;
  let basis: PriceBasis = 'MANUAL';
  if (unitPrice === null) {
    const suggested = await suggestedPrice(principal, {
      productId: input.productId,
      customerId: order.customerId,
    });
    unitPrice = suggested?.pricePesewas ?? null;
    basis = suggested?.basis ?? 'MANUAL';
  }

  const problems = lineErrors({ quantity: input.quantity, unitPricePesewas: unitPrice });
  if (problems.length > 0) throw new SalesError(problems[0]);

  const created = await db.salesOrderLine.create({
    data: {
      salesOrderId: orderId,
      productId: input.productId,
      quantity: input.quantity,
      unitPricePesewas: unitPrice as Pesewas,
      priceBasis: basis,
      note: input.note,
    },
    select: { id: true },
  });
  return created;
}

export async function removeLine(
  principal: Principal,
  orderId: string,
  lineId: string,
): Promise<void> {
  const order = await orderById(principal, orderId);
  if (!order) throw new SalesError('That order no longer exists.');
  if (order.state !== 'DRAFT') {
    throw new SalesError('Only a draft can be changed. Cancel it and write a new one.');
  }

  // A LINE ON A DRAFT IS DELETED OUTRIGHT, and that is the one place in this
  // codebase where a delete is right: a draft is not yet a record of anything.
  // Nothing outside the farm has seen it, no promise was made, and keeping every
  // line somebody typed and removed would make the audit trail unreadable
  // without telling anyone anything. The moment it is confirmed, that stops
  // being true — which is why lines are locked from then on.
  await db.salesOrderLine.deleteMany({ where: { id: lineId, salesOrderId: orderId } });
}

/**
 * Houses currently inside an egg withdrawal period.
 *
 * Only EGGS — a spent-hen sale is a meat sale and carries its own period, but
 * this farm sells birds as a whole flock at depletion rather than as order
 * lines, so meat is not gated here. When that changes, this function grows a
 * `kind` and the gate takes both.
 */
export async function restrictedFlocks(
  principal: Principal,
  asOf: Date = new Date(),
): Promise<RestrictedFlock[]> {
  const rows = await withdrawalsAcrossFlocks(principal, asOf);
  return rows
    .filter((f) => f.eggsClearOn !== null)
    .map((f) => ({
      flockId: f.flockId,
      name: f.houseName ?? f.flockCode,
      clearsOn: f.eggsClearOn as Date,
    }));
}

/** The gate, answered without throwing, so a screen can warn before somebody tries. */
export async function withdrawalCheck(
  principal: Principal,
  order: SalesOrder,
  asOf: Date = new Date(),
): Promise<WithdrawalVerdict> {
  return withdrawalGate({
    restricted: await restrictedFlocks(principal, asOf),
    drawnFromFlockId: order.drawnFromFlockId,
    hasProduceLines: order.lines.length > 0,
  });
}

export async function setDrawnFrom(
  principal: Principal,
  orderId: string,
  flockId: string | null,
): Promise<void> {
  const order = await orderById(principal, orderId);
  if (!order) throw new SalesError('That order no longer exists.');
  if (order.state !== 'DRAFT') throw new SalesError('Only a draft can be changed.');

  if (flockId) {
    const flock = await db.animalGroup.findFirst({
      where: { id: flockId, site: orgFilter(principal), ...siteFilter(principal) },
      select: { id: true },
    });
    if (!flock) throw new SalesError('That house is not one you have access to.');
  }

  await db.salesOrder.update({ where: { id: orderId }, data: { drawnFromFlockId: flockId } });
}

/**
 * Confirm it with the buyer.
 *
 * THE WITHDRAWAL GATE IS CHECKED HERE, not when the line was added — because a
 * treatment recorded this morning restricts an order written yesterday, and a
 * check that ran only at line time would let that order through.
 */
export async function confirmOrder(
  principal: Principal,
  orderId: string,
  asOf: Date = new Date(),
): Promise<{ orderNumber: string }> {
  const order = await orderById(principal, orderId);
  if (!order) throw new SalesError('That order no longer exists.');

  const problems = confirmErrors(order);
  if (problems.length > 0) throw new SalesError(problems[0]);

  const verdict = await withdrawalCheck(principal, order, asOf);
  if (verdict.kind === 'REFUSED') {
    const restricted = await restrictedFlocks(principal, asOf);
    const blocked = restricted.find((r) => r.flockId === order.drawnFromFlockId);
    throw new SalesError(verdict.message, blocked?.clearsOn ?? null);
  }
  if (verdict.kind === 'NEEDS_SOURCE') {
    throw new SalesError(verdict.message);
  }

  await db.salesOrder.update({
    where: { id: orderId },
    data: { state: 'CONFIRMED', confirmedAt: new Date(), confirmedById: principal.userId },
  });
  return { orderNumber: order.orderNumber };
}

export async function cancelOrder(
  principal: Principal,
  orderId: string,
  reason: string,
): Promise<{ orderNumber: string }> {
  const order = await orderById(principal, orderId);
  if (!order) throw new SalesError('That order no longer exists.');

  const problems = cancelErrors({ state: order.state, reason });
  if (problems.length > 0) throw new SalesError(problems[0]);

  await db.salesOrder.update({
    where: { id: orderId },
    data: {
      state: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledById: principal.userId,
      cancelReason: reason.trim(),
    },
  });
  return { orderNumber: order.orderNumber };
}

/** Buyers, sites, products and houses for the pickers. */
export async function orderContext(principal: Principal) {
  const [customers, sites, products, flocks] = await Promise.all([
    db.customer.findMany({
      where: { ...orgFilter(principal), archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, businessName: true },
    }),
    db.site.findMany({
      where: {
        ...orgFilter(principal),
        isActive: true,
        ...(principal.siteScope.length > 0 ? { id: { in: principal.siteScope } } : {}),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    db.product.findMany({
      where: { ...orgFilter(principal), isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, packLabel: true, unitsPerPack: true },
    }),
    db.animalGroup.findMany({
      where: { site: orgFilter(principal), ...siteFilter(principal), closedAt: null },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, productionUnit: { select: { name: true } } },
    }),
  ]);

  return {
    customers,
    sites,
    products,
    flocks: flocks.map((f) => ({ id: f.id, name: f.productionUnit?.name ?? f.code })),
  };
}
