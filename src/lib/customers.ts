import { toE164Ghana, formatGhanaPhone } from '@/lib/brand';

/**
 * Customers — ADRAH Farms
 *
 * Who the farm sells to. Pure; no database.
 *
 * THE PHONE NUMBER IS THE IDENTITY, NOT THE NAME.
 *   In Ghana a small buyer is reached on one mobile number and often has no
 *   email, no company registration and no fixed address worth typing. The same
 *   person is "Akosua", "Auntie Akosua" and "Mensah Provisions" depending on who
 *   is writing it down, and after six weeks of that a customer list has three
 *   rows for one buyer and an outstanding balance split across them.
 *
 *   So the number is what this module compares, normalised to E.164 before
 *   comparing, and the name is just a label. Everything else about a customer is
 *   optional.
 *
 * A DUPLICATE IS WARNED ABOUT, NEVER BLOCKED.
 *   Two businesses genuinely do share a number — a shop and the owner's other
 *   shop, a husband and wife buying separately — and refusing the second one
 *   would send whoever is standing at the counter into inventing a fake digit to
 *   get past the form. The warning names the existing customer and offers to
 *   open them instead, which is what the person actually wanted nine times out
 *   of ten. See `duplicateWarning`.
 *
 * CUSTOMERS ARE NEVER DELETED. A buyer who stopped buying is the history behind
 * every figure in every report that covers the period they were buying in.
 * Archiving hides them from the pickers; nothing removes them.
 */

export const CUSTOMER_KINDS = ['WHOLESALE', 'RETAIL'] as const;
export type CustomerKind = (typeof CUSTOMER_KINDS)[number];

export const KIND_LABELS: Record<CustomerKind, string> = {
  WHOLESALE: 'Wholesale',
  RETAIL: 'Retail',
};

export const KIND_HINTS: Record<CustomerKind, string> = {
  WHOLESALE: 'Buys by the crate, usually to a standing arrangement.',
  RETAIL: 'Buys occasionally, in trays or single crates.',
};

export interface Customer {
  id: string;
  name: string;
  /** E.164 where it could be normalised, as typed where it could not. */
  phone: string;
  kind: CustomerKind;
  businessName: string | null;
  email: string | null;
  /** Where they are, in the words somebody would use giving directions. */
  town: string | null;
  notes: string | null;
  /** The enquiry this customer came from, if they came from one. */
  fromEnquiryId: string | null;
  /**
   * NOT A PERSON — the standing row gate cash sales are recorded against.
   *
   * Carried on the type so every screen that offers to ring somebody can decline
   * to offer it here, rather than rendering a Call button over an empty number.
   */
  isCounterSale: boolean;
  createdAt: Date;
  createdByName: string | null;
  archivedAt: Date | null;
  archivedByName: string | null;
  archiveReason: string | null;
}

export function isArchived(customer: Customer): boolean {
  return customer.archivedAt !== null;
}

/** How a customer is named on a list row: the business if there is one. */
export function displayName(customer: Customer): string {
  if (customer.businessName && customer.businessName.trim().length > 0) {
    return `${customer.businessName} · ${customer.name}`;
  }
  return customer.name;
}

/**
 * The comparable form of a phone number.
 *
 * NORMALISED BEFORE COMPARING, ALWAYS. `0244778899`, `+233 24 477 8899` and
 * `233244778899` are one number written three ways, and a duplicate check that
 * compares the strings finds none of them. Where the number cannot be parsed —
 * a foreign buyer, a landline written oddly — the trimmed digits are used, which
 * still catches the same string typed twice.
 */
export function comparablePhone(phone: string): string {
  return toE164Ghana(phone) ?? phone.replace(/\D/g, '');
}

export function samePhone(a: string, b: string): boolean {
  const left = comparablePhone(a);
  const right = comparablePhone(b);
  return left.length > 0 && left === right;
}

export interface DuplicateWarning {
  customerId: string;
  message: string;
}

/**
 * Somebody with this number is already on the list.
 *
 * A WARNING WITH A WAY OUT, not a refusal. It names who it found and says what
 * to do, because the person filling in this form is usually standing in front of
 * the customer and needs an answer in two seconds.
 */
export function duplicateWarning(
  phone: string,
  existing: { id: string; name: string; businessName: string | null }[],
): DuplicateWarning | null {
  const match = existing[0];
  if (!match) return null;

  const who = match.businessName ? `${match.businessName} (${match.name})` : match.name;
  return {
    customerId: match.id,
    message: `${formatGhanaPhone(phone)} is already on the list, as ${who}. Open them instead unless this really is a different buyer on the same number — that does happen, and saving again will keep both.`,
  };
}

/**
 * What a customer record needs before it is worth keeping.
 *
 * A NAME AND A NUMBER. Nothing else, for the same reason the enquiry form asks
 * for almost nothing: this gets filled in at a counter with somebody waiting,
 * and every extra required box is a sale recorded against "walk-in" instead.
 */
export function customerErrors(input: {
  name: string;
  phone: string;
}): string[] {
  const problems: string[] = [];

  if (input.name.trim().length < 2) {
    problems.push('Give them a name — whatever you would call them.');
  }

  const digits = input.phone.replace(/\D/g, '');
  if (digits.length < 6) {
    problems.push('A number you can reach them on. However you write it.');
  }

  return problems;
}

/**
 * Archiving needs a reason.
 *
 * The same rule as everywhere else here: a record that disappeared with no
 * explanation is one nobody can defend a year later. "Closed the shop" and
 * "duplicate of Mensah Provisions" are different facts, and only one of them
 * means the balance should have been chased.
 */
export function archiveErrors(reason: string): string[] {
  if (reason.trim().length < 3) {
    return ['Say why in a few words — "closed the shop", "duplicate of…", whatever it is.'];
  }
  return [];
}

/**
 * Newest first, with archived at the bottom.
 *
 * NOT SORTED BY WHAT THEY SPEND. The farm has no revenue yet, and when it does,
 * a customer list ordered by value is one where the person looking for Auntie
 * Akosua scrolls past her twice. Alphabetical within a group would be defensible
 * too; recency wins because the buyer somebody is looking for is usually the one
 * they just added.
 */
export function sortCustomers(customers: Customer[]): Customer[] {
  return [...customers].sort((a, b) => {
    const archived = Number(isArchived(a)) - Number(isArchived(b));
    if (archived !== 0) return archived;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

/** Match on anything somebody might type into a search box. */
export function matches(customer: Customer, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;

  // A NUMBER TYPED IN ANY FORM FINDS THE CUSTOMER. Somebody searching by phone
  // has almost certainly copied it from WhatsApp, where it is +233…, while the
  // record may hold 024…, and the raw comparison would find nothing.
  const asPhone = comparablePhone(q);
  if (asPhone.length >= 6 && comparablePhone(customer.phone).includes(asPhone)) return true;

  return [customer.name, customer.businessName, customer.town, customer.email]
    .filter((f): f is string => typeof f === 'string')
    .some((f) => f.toLowerCase().includes(q));
}

export function customerSummary(customers: Customer[]): string {
  const active = customers.filter((c) => !isArchived(c));
  if (customers.length === 0) {
    return 'Nobody on the list yet. Add a buyer here, or turn an enquiry into one.';
  }
  const wholesale = active.filter((c) => c.kind === 'WHOLESALE').length;
  return `${active.length} ${active.length === 1 ? 'buyer' : 'buyers'}${
    wholesale > 0 ? `, ${wholesale} wholesale` : ''
  }.`;
}
