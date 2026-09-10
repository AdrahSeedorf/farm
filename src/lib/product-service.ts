import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter } from '@/lib/scope';
import { pesewas, type Pesewas } from '@/lib/money';
import {
  priceFor,
  nextPrice,
  productErrors,
  priceErrors,
  type Product,
  type PriceRow,
  type ResolvedPrice,
} from '@/lib/pricing';
import type { ProductInput, PriceInput } from '@/lib/validation/product';

/**
 * Products and prices — ADRAH Farms
 *
 * THE ONLY PLACE A Product OR ProductPrice IS WRITTEN.
 *
 * PRICES ARE ONLY EVER INSERTED. There is no `update` on ProductPrice anywhere
 * in this file, and that is the point rather than an oversight — a price row
 * that could be edited would take the March figure with it, and the March
 * invoice with that. Correcting a price is a new row dated the same day; the
 * resolution rule prefers the one entered last.
 */

export class ProductError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductError';
  }
}

type DbProduct = {
  id: string;
  sku: string;
  name: string;
  gradeId: string | null;
  unitsPerPack: number;
  packLabel: string;
  isActive: boolean;
  notes: string | null;
  grade: { name: string } | null;
};

function toProduct(row: DbProduct): Product {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    gradeId: row.gradeId,
    gradeName: row.grade?.name ?? null,
    unitsPerPack: row.unitsPerPack,
    packLabel: row.packLabel,
    isActive: row.isActive,
    notes: row.notes,
  };
}

type DbPrice = {
  id: string;
  productId: string;
  customerId: string | null;
  pricePesewas: number | null;
  effectiveFrom: Date;
  note: string | null;
  createdAt: Date;
  setBy: { name: string } | null;
};

function toPriceRow(row: DbPrice): PriceRow {
  return {
    id: row.id,
    productId: row.productId,
    customerId: row.customerId,
    pricePesewas: row.pricePesewas === null ? null : pesewas(row.pricePesewas),
    effectiveFrom: row.effectiveFrom,
    note: row.note,
    setByName: row.setBy?.name ?? null,
    createdAt: row.createdAt,
  };
}

export async function listProducts(
  principal: Principal,
  options: { includeInactive?: boolean } = {},
): Promise<Product[]> {
  const rows = await db.product.findMany({
    where: {
      ...orgFilter(principal),
      ...(options.includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: { grade: { select: { name: true } } },
  });
  return rows.map((r) => toProduct(r as unknown as DbProduct));
}

export async function productById(
  principal: Principal,
  productId: string,
): Promise<Product | null> {
  const row = await db.product.findFirst({
    where: { id: productId, ...orgFilter(principal) },
    include: { grade: { select: { name: true } } },
  });
  return row ? toProduct(row as unknown as DbProduct) : null;
}

/**
 * Every price row the farm holds.
 *
 * READ WHOLE, AND RESOLVED IN MEMORY. The alternative — a clever query per
 * product per customer — is several round trips to answer one screen, and the
 * rule it would have to encode (customer beats list, newest wins, a null price
 * falls through) is exactly the kind of logic that belongs somewhere it can be
 * tested rather than in a `where` clause. A price list is a few hundred rows for
 * years; when it is not, the fix is a date bound here, not a looser rule.
 */
export async function allPrices(
  principal: Principal,
  options: { productId?: string; customerId?: string } = {},
): Promise<PriceRow[]> {
  const rows = await db.productPrice.findMany({
    where: {
      ...orgFilter(principal),
      ...(options.productId ? { productId: options.productId } : {}),
      ...(options.customerId
        ? { OR: [{ customerId: options.customerId }, { customerId: null }] }
        : {}),
    },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    include: { setBy: { select: { name: true } } },
  });
  return rows.map((r) => toPriceRow(r as unknown as DbPrice));
}

export interface PricedProduct {
  product: Product;
  price: ResolvedPrice | null;
  /** A dated change not yet in force. */
  coming: PriceRow | null;
}

/**
 * The price list as somebody quoting from it needs to see it.
 *
 * TWO QUERIES FOR THE WHOLE SCREEN, whatever the number of products.
 */
export async function pricedProducts(
  principal: Principal,
  options: { customerId?: string; on?: Date; includeInactive?: boolean } = {},
): Promise<PricedProduct[]> {
  const on = options.on ?? new Date();
  const [products, prices] = await Promise.all([
    listProducts(principal, { includeInactive: options.includeInactive }),
    allPrices(principal, { customerId: options.customerId }),
  ]);

  const customerId = options.customerId ?? null;
  return products.map((product) => ({
    product,
    price: priceFor(prices, { productId: product.id, customerId, on }),
    coming: nextPrice(prices, { productId: product.id, customerId, on }),
  }));
}

export async function createProduct(
  principal: Principal,
  input: ProductInput,
): Promise<{ id: string }> {
  const problems = productErrors(input);
  if (problems.length > 0) throw new ProductError(problems[0]);

  try {
    return await db.product.create({
      data: {
        organisationId: principal.organisationId,
        sku: input.sku.trim(),
        name: input.name.trim(),
        gradeId: input.gradeId,
        unitsPerPack: input.unitsPerPack,
        packLabel: input.packLabel.trim(),
        notes: input.notes,
      },
      select: { id: true },
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      throw new ProductError(`Something else already uses the code ${input.sku}.`);
    }
    throw error;
  }
}

export async function updateProduct(
  principal: Principal,
  productId: string,
  input: ProductInput,
): Promise<{ id: string }> {
  const existing = await productById(principal, productId);
  if (!existing) throw new ProductError('That product no longer exists.');

  const problems = productErrors(input);
  if (problems.length > 0) throw new ProductError(problems[0]);

  try {
    await db.product.update({
      where: { id: productId },
      data: {
        sku: input.sku.trim(),
        name: input.name.trim(),
        gradeId: input.gradeId,
        unitsPerPack: input.unitsPerPack,
        packLabel: input.packLabel.trim(),
        notes: input.notes,
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      throw new ProductError(`Something else already uses the code ${input.sku}.`);
    }
    throw error;
  }
  return { id: productId };
}

/**
 * Take a product off the list.
 *
 * `isActive` RATHER THAN A DELETE, because the price rows and — soon — the order
 * lines that reference it are the record of everything ever sold under it. A
 * product nobody sells any more is still the product on last year's invoices.
 */
export async function setProductActive(
  principal: Principal,
  productId: string,
  isActive: boolean,
): Promise<{ name: string }> {
  const existing = await productById(principal, productId);
  if (!existing) throw new ProductError('That product no longer exists.');

  await db.product.update({ where: { id: productId }, data: { isActive } });
  return { name: existing.name };
}

/**
 * Set a price.
 *
 * ALWAYS AN INSERT. See the note at the top of this file.
 */
export async function setPrice(
  principal: Principal,
  input: PriceInput,
): Promise<{ id: string }> {
  const product = await productById(principal, input.productId);
  if (!product) throw new ProductError('That product no longer exists.');

  if (input.customerId) {
    const customer = await db.customer.findFirst({
      where: { id: input.customerId, ...orgFilter(principal) },
      select: { id: true },
    });
    if (!customer) throw new ProductError('That buyer is no longer on the list.');
  }

  const amount: Pesewas | null =
    input.pricePesewas === null ? null : pesewas(input.pricePesewas);

  const problems = priceErrors({
    pricePesewas: amount,
    effectiveFrom: input.effectiveFrom,
    note: input.note,
  });
  if (problems.length > 0) throw new ProductError(problems[0]);

  const created = await db.productPrice.create({
    data: {
      organisationId: principal.organisationId,
      productId: input.productId,
      customerId: input.customerId,
      pricePesewas: amount,
      effectiveFrom: input.effectiveFrom,
      note: input.note,
      setById: principal.userId,
    },
    select: { id: true },
  });
  return created;
}

/** The grades a product can be drawn from, for the picker. */
export async function saleableGrades(principal: Principal) {
  return db.productionGrade.findMany({
    where: {
      isActive: true,
      productionType: { speciesProfile: { organisationId: principal.organisationId } },
    },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, isSaleable: true },
  });
}

/** Buyers who can be given an agreed price. */
export async function pricableCustomers(principal: Principal) {
  return db.customer.findMany({
    where: { ...orgFilter(principal), archivedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, businessName: true },
  });
}
