import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter } from '@/lib/scope';
import { formatGhanaPhone, whatsappLink, telLink } from '@/lib/ghana';
import { supplierCodeFrom, type SupplierInput } from '@/lib/validation/purchasing';

/**
 * Suppliers — ADRAH Farms
 *
 * THE ONLY PLACE A Supplier IS WRITTEN.
 *
 * Suppliers are ARCHIVED, never deleted. A year of feed deliveries has to stay
 * readable after the farm stops using that mill, and an order pointing at a row
 * nobody can name is worse than an order pointing at a retired one.
 */

export class SupplierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupplierError';
  }
}

export interface SupplierRow {
  id: string;
  name: string;
  code: string;
  contactName: string | null;
  phone: string | null;
  /** The number read back the way a Ghanaian would say it. */
  phoneDisplay: string | null;
  /** Null when the digits given cannot make a dialable number. */
  telHref: string | null;
  whatsappHref: string | null;
  altPhone: string | null;
  altPhoneDisplay: string | null;
  email: string | null;
  place: string | null;
  supplies: string[];
  leadTimeDays: number | null;
  /** The figure actually used for this supplier — its own, or the farm's. */
  effectiveLeadTimeDays: number;
  /** True when the farm-wide figure is standing in. */
  usingFarmDefault: boolean;
  paymentTerms: string | null;
  notes: string | null;
  isActive: boolean;
}

function toRow(
  s: {
    id: string;
    name: string;
    code: string;
    contactName: string | null;
    phone: string | null;
    altPhone: string | null;
    email: string | null;
    town: string | null;
    district: string | null;
    region: string | null;
    supplies: string[];
    leadTimeDays: number | null;
    paymentTerms: string | null;
    notes: string | null;
    isActive: boolean;
  },
  farmLeadTimeDays: number,
): SupplierRow {
  return {
    id: s.id,
    name: s.name,
    code: s.code,
    contactName: s.contactName,
    phone: s.phone,
    phoneDisplay: formatGhanaPhone(s.phone),
    telHref: telLink(s.phone),
    whatsappHref: whatsappLink(s.phone),
    altPhone: s.altPhone,
    altPhoneDisplay: formatGhanaPhone(s.altPhone),
    email: s.email,
    place: [s.town, s.district, s.region].filter(Boolean).join(', ') || null,
    supplies: s.supplies,
    leadTimeDays: s.leadTimeDays,
    // The supplier's own figure when it has one, the farm's average otherwise.
    // See Supplier.leadTimeDays: a mill two weeks away and a shop that delivers
    // next morning should not share one number.
    effectiveLeadTimeDays: s.leadTimeDays ?? farmLeadTimeDays,
    usingFarmDefault: s.leadTimeDays === null,
    paymentTerms: s.paymentTerms,
    notes: s.notes,
    isActive: s.isActive,
  };
}

/**
 * The farm-wide average lead time.
 *
 * Exported so the supplier form can SHOW the figure a blank box will fall back
 * to. A blank field that silently means something is a blank field somebody
 * fills in with a guess.
 */
export async function farmLeadTime(principal: Principal): Promise<number> {
  const org = await db.organisation.findUnique({
    where: { id: principal.organisationId },
    select: { stockLeadTimeDays: true },
  });
  return org?.stockLeadTimeDays ?? 7;
}

export async function listSuppliers(
  principal: Principal,
  includeArchived = false,
): Promise<SupplierRow[]> {
  const [rows, lead] = await Promise.all([
    db.supplier.findMany({
      where: { ...orgFilter(principal), ...(includeArchived ? {} : { isActive: true }) },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    }),
    farmLeadTime(principal),
  ]);
  return rows.map((r) => toRow(r, lead));
}

export async function supplierById(
  principal: Principal,
  supplierId: string,
): Promise<SupplierRow | null> {
  const [row, lead] = await Promise.all([
    db.supplier.findFirst({ where: { id: supplierId, ...orgFilter(principal) } }),
    farmLeadTime(principal),
  ]);
  return row ? toRow(row, lead) : null;
}

export async function createSupplier(
  principal: Principal,
  input: SupplierInput,
  supplies: string[],
): Promise<string> {
  const code = input.code ?? supplierCodeFrom(input.name);

  const clash = await db.supplier.findFirst({
    where: { ...orgFilter(principal), code },
    select: { name: true, isActive: true },
  });
  if (clash) {
    throw new SupplierError(
      clash.isActive
        ? `${clash.name} already uses the code ${code}. Give this one a different code.`
        : `${clash.name} used the code ${code} and is archived. Restore it, or use another code.`,
    );
  }

  const created = await db.supplier.create({
    data: {
      organisationId: principal.organisationId,
      name: input.name,
      code,
      contactName: input.contactName,
      phone: input.phone,
      altPhone: input.altPhone,
      email: input.email,
      town: input.town,
      district: input.district,
      region: input.region ?? null,
      supplies: supplies as never[],
      leadTimeDays: input.leadTimeDays,
      paymentTerms: input.paymentTerms,
      notes: input.notes,
    },
    select: { id: true },
  });
  return created.id;
}

export async function updateSupplier(
  principal: Principal,
  supplierId: string,
  input: SupplierInput,
  supplies: string[],
): Promise<void> {
  const before = await db.supplier.findFirst({
    where: { id: supplierId, ...orgFilter(principal) },
    select: { id: true, code: true },
  });
  if (!before) throw new SupplierError('That supplier no longer exists.');

  // THE CODE IS NEVER REWRITTEN once it exists. It is what a past invoice
  // quotes, and renaming a supplier should change what the screens say without
  // orphaning the paperwork.
  await db.supplier.update({
    where: { id: before.id },
    data: {
      name: input.name,
      contactName: input.contactName,
      phone: input.phone,
      altPhone: input.altPhone,
      email: input.email,
      town: input.town,
      district: input.district,
      region: input.region ?? null,
      supplies: supplies as never[],
      leadTimeDays: input.leadTimeDays,
      paymentTerms: input.paymentTerms,
      notes: input.notes,
    },
  });
}

/** Archive or restore. Never deleted — orders point at it. */
export async function setSupplierActive(
  principal: Principal,
  supplierId: string,
  isActive: boolean,
): Promise<string> {
  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, ...orgFilter(principal) },
    select: { id: true, name: true },
  });
  if (!supplier) throw new SupplierError('That supplier no longer exists.');

  await db.supplier.update({ where: { id: supplier.id }, data: { isActive } });
  return supplier.name;
}
