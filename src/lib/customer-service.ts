import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter } from '@/lib/scope';
import { toE164Ghana } from '@/lib/brand';
import {
  comparablePhone,
  customerErrors,
  archiveErrors,
  duplicateWarning,
  type Customer,
  type CustomerKind,
  type DuplicateWarning,
} from '@/lib/customers';
import type { CustomerInput } from '@/lib/validation/customer';

/**
 * Customer service — ADRAH Farms
 *
 * THE ONLY PLACE A Customer IS WRITTEN.
 *
 * CUSTOMERS ARE ORGANISATION-WIDE, NOT SITE-SCOPED, and that is a decision
 * rather than an omission. A buyer belongs to the business, not to a house: the
 * same shop may collect from whichever site has stock that week, and splitting
 * them per site would give one buyer two balances and two histories. Where a
 * sale happens is a property of the sale.
 */

export class CustomerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomerError';
  }
}

const include = {
  createdBy: { select: { name: true } },
  archivedBy: { select: { name: true } },
} as const;

type DbCustomer = {
  id: string;
  name: string;
  phone: string;
  kind: CustomerKind;
  businessName: string | null;
  email: string | null;
  town: string | null;
  notes: string | null;
  fromEnquiryId: string | null;
  createdAt: Date;
  archivedAt: Date | null;
  archiveReason: string | null;
  createdBy: { name: string } | null;
  archivedBy: { name: string } | null;
};

function toCustomer(row: DbCustomer): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    kind: row.kind,
    businessName: row.businessName,
    email: row.email,
    town: row.town,
    notes: row.notes,
    fromEnquiryId: row.fromEnquiryId,
    createdAt: row.createdAt,
    createdByName: row.createdBy?.name ?? null,
    archivedAt: row.archivedAt,
    archivedByName: row.archivedBy?.name ?? null,
    archiveReason: row.archiveReason,
  };
}

export async function listCustomers(
  principal: Principal,
  options: { includeArchived?: boolean } = {},
): Promise<Customer[]> {
  const rows = await db.customer.findMany({
    where: {
      ...orgFilter(principal),
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { createdAt: 'desc' },
    include,
  });
  return rows.map((r) => toCustomer(r as unknown as DbCustomer));
}

export async function customerById(
  principal: Principal,
  customerId: string,
): Promise<Customer | null> {
  const row = await db.customer.findFirst({
    where: { id: customerId, ...orgFilter(principal) },
    include,
  });
  return row ? toCustomer(row as unknown as DbCustomer) : null;
}

/**
 * Anybody already on the list with this number.
 *
 * THE COMPARISON IS DONE IN MEMORY, NOT IN SQL, and it is worth saying why: the
 * stored numbers are mostly E.164 but not all of them, because a number this
 * system could not parse is kept as typed rather than thrown away. A `where`
 * clause on the normalised form would silently miss exactly those rows. On a
 * farm with a few hundred buyers, reading the phone column and comparing it
 * properly is cheaper than being wrong.
 *
 * If this list ever runs to tens of thousands, the answer is a stored normalised
 * column maintained by this service — not a looser comparison.
 */
export async function findByPhone(
  principal: Principal,
  phone: string,
  options: { excludeId?: string } = {},
): Promise<{ id: string; name: string; businessName: string | null }[]> {
  const wanted = comparablePhone(phone);
  if (wanted.length < 6) return [];

  const rows = await db.customer.findMany({
    where: { ...orgFilter(principal), archivedAt: null },
    select: { id: true, name: true, businessName: true, phone: true },
  });

  return rows
    .filter((r) => r.id !== options.excludeId && comparablePhone(r.phone) === wanted)
    .map(({ id, name, businessName }) => ({ id, name, businessName }));
}

export interface SaveResult {
  id: string;
  /** Present when somebody with this number was already on the list. */
  warning: DuplicateWarning | null;
}

/**
 * Add a buyer.
 *
 * A DUPLICATE NUMBER RETURNS A WARNING ALONGSIDE THE SAVED ROW, rather than
 * refusing. The record is created either way — the person at the counter needs
 * to get on with the sale — and the warning tells them who else holds that
 * number so they can merge it later if it was a mistake.
 */
export async function createCustomer(
  principal: Principal,
  input: CustomerInput,
): Promise<SaveResult> {
  const problems = customerErrors({ name: input.name, phone: input.phone });
  if (problems.length > 0) throw new CustomerError(problems[0]);

  const existing = await findByPhone(principal, input.phone);

  const created = await db.customer.create({
    data: {
      organisationId: principal.organisationId,
      kind: input.kind,
      name: input.name,
      // Normalised where possible, kept as typed where not — the same rule as
      // enquiries, for the same reason.
      phone: toE164Ghana(input.phone) ?? input.phone,
      businessName: input.businessName,
      email: input.email,
      town: input.town,
      notes: input.notes,
      fromEnquiryId: input.fromEnquiryId ?? null,
      createdById: principal.userId,
    },
    select: { id: true },
  });

  return { id: created.id, warning: duplicateWarning(input.phone, existing) };
}

export async function updateCustomer(
  principal: Principal,
  customerId: string,
  input: CustomerInput,
): Promise<SaveResult> {
  const existingCustomer = await customerById(principal, customerId);
  if (!existingCustomer) throw new CustomerError('That buyer is no longer on the list.');

  const problems = customerErrors({ name: input.name, phone: input.phone });
  if (problems.length > 0) throw new CustomerError(problems[0]);

  const clashes = await findByPhone(principal, input.phone, { excludeId: customerId });

  await db.customer.update({
    where: { id: customerId },
    data: {
      kind: input.kind,
      name: input.name,
      phone: toE164Ghana(input.phone) ?? input.phone,
      businessName: input.businessName,
      email: input.email,
      town: input.town,
      notes: input.notes,
    },
  });

  return { id: customerId, warning: duplicateWarning(input.phone, clashes) };
}

export async function archiveCustomer(
  principal: Principal,
  customerId: string,
  reason: string,
): Promise<{ name: string }> {
  const existing = await customerById(principal, customerId);
  if (!existing) throw new CustomerError('That buyer is no longer on the list.');
  if (existing.archivedAt) throw new CustomerError('That buyer is already put aside.');

  const problems = archiveErrors(reason);
  if (problems.length > 0) throw new CustomerError(problems[0]);

  await db.customer.update({
    where: { id: customerId },
    data: {
      archivedAt: new Date(),
      archivedById: principal.userId,
      archiveReason: reason.trim(),
    },
  });
  return { name: existing.name };
}

/** Bring one back. Making the list longer needs no more authority than shortening it. */
export async function restoreCustomer(
  principal: Principal,
  customerId: string,
): Promise<{ name: string }> {
  const existing = await customerById(principal, customerId);
  if (!existing) throw new CustomerError('That buyer is no longer on the list.');
  if (!existing.archivedAt) throw new CustomerError('That buyer is already on the list.');

  // THE REASON IS KEPT. Why somebody was put aside is still true after they are
  // brought back, and clearing it would erase the only explanation of a gap in
  // their history.
  await db.customer.update({
    where: { id: customerId },
    data: { archivedAt: null, archivedById: null },
  });
  return { name: existing.name };
}

/**
 * Turn an answered enquiry into a buyer.
 *
 * THE ENQUIRY IS NOT CONSUMED. It stays exactly where it is, with its own
 * history, and the customer simply records which enquiry produced them. That is
 * what lets the farm answer "did the website actually bring us anybody?" — a
 * question worth being able to answer before renewing anything.
 *
 * One enquiry produces at most one customer, enforced by a unique constraint:
 * clicking twice gets the same buyer rather than two.
 */
export async function customerFromEnquiry(
  principal: Principal,
  enquiryId: string,
): Promise<SaveResult> {
  const enquiry = await db.enquiry.findFirst({
    where: { id: enquiryId, ...orgFilter(principal) },
    include: { customer: { select: { id: true } } },
  });
  if (!enquiry) throw new CustomerError('That enquiry no longer exists.');
  if (enquiry.customer) {
    return { id: enquiry.customer.id, warning: null };
  }

  return createCustomer(principal, {
    kind: enquiry.kind === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL',
    name: enquiry.name,
    phone: enquiry.phone,
    businessName: enquiry.businessName,
    email: enquiry.email,
    town: null,
    // WHAT THEY ASKED FOR IS CARRIED ACROSS, because it is the most useful thing
    // anybody will want when they next pick up this buyer, and it is otherwise a
    // click away on a different screen.
    notes: [
      enquiry.cratesPerWeek ? `Asked about ${enquiry.cratesPerWeek} crates a week` : null,
      enquiry.fromWhen ? `from ${enquiry.fromWhen}` : null,
      enquiry.message,
    ]
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .join('. '),
    fromEnquiryId: enquiry.id,
  });
}
