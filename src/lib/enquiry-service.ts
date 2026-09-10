import 'server-only';
import { db } from '@/lib/db';
import { toE164Ghana } from '@/lib/brand';
import type { EnquiryInput } from '@/lib/validation/enquiry';
import type { Principal } from '@/lib/rbac';
import { orgFilter } from '@/lib/scope';
import { answerErrors, type Enquiry, type EnquiryKind } from '@/lib/enquiries';

/**
 * Enquiries — ADRAH Farms
 *
 * THE ONLY PLACE AN Enquiry IS WRITTEN, and the only write in this codebase that
 * happens without a signed-in principal. Everything below is shaped by that.
 *
 * IT TAKES NO `Principal`, ON PURPOSE.
 *   A service that accepted one and treated null as "public" would be one
 *   forgotten null-check away from letting a stranger act as somebody. This
 *   function cannot impersonate anybody because it was never handed anybody.
 *
 * IT RESOLVES THE ORGANISATION ITSELF.
 *   A public visitor has no organisation, so this is the single place in the
 *   codebase that reads "the" organisation rather than the caller's. That is
 *   sound while this is a single-farm install and it is a real limit: the day
 *   this platform hosts two farms, the public site needs a domain-to-farm
 *   mapping and this function needs to take the answer. Written down here rather
 *   than discovered then.
 *
 * IT CANNOT DAMAGE ANYTHING.
 *   An enquiry touches no ledger, no price, no flock. The worst a flood of
 *   rubbish can do is fill a list somebody archives, which is why the rate limit
 *   below is about keeping that list readable rather than about security.
 */

export class EnquiryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnquiryError';
  }
}

/**
 * How many enquiries one address may send in an hour.
 *
 * Six. A buyer sending a second enquiry because they forgot to mention delivery
 * is normal; a seventh in an hour from one address is not a buyer. It is
 * deliberately loose — a shared office connection is one address, and turning
 * away a real wholesale customer costs the farm far more than an afternoon
 * spent archiving spam.
 */
export const ENQUIRY_LIMIT = { perHour: 6, windowMinutes: 60 } as const;

export async function enquiryAllowed(ipAddress: string | null): Promise<boolean> {
  if (!ipAddress) return true;
  const since = new Date(Date.now() - ENQUIRY_LIMIT.windowMinutes * 60_000);
  const recent = await db.enquiry.count({
    where: { ipAddress, createdAt: { gte: since } },
  });
  return recent < ENQUIRY_LIMIT.perHour;
}

export async function recordEnquiry(
  input: EnquiryInput,
  ipAddress: string | null,
): Promise<{ id: string }> {
  if (!(await enquiryAllowed(ipAddress))) {
    throw new EnquiryError(
      'That is several enquiries in a short time. Give it an hour, or ring us instead — we would rather talk anyway.',
    );
  }

  const organisation = await db.organisation.findFirst({ select: { id: true } });
  if (!organisation) throw new EnquiryError('We cannot take enquiries just now.');

  // NORMALISED WHERE POSSIBLE, KEPT AS TYPED WHERE NOT. A number this system
  // cannot parse into E.164 is still a number a person can ring, and throwing it
  // away to keep the column tidy would lose the customer rather than the typo.
  const phone = toE164Ghana(input.phone) ?? input.phone;

  const created = await db.enquiry.create({
    data: {
      organisationId: organisation.id,
      kind: input.kind,
      name: input.name,
      phone,
      email: input.email,
      businessName: input.businessName,
      cratesPerWeek: input.cratesPerWeek,
      fromWhen: input.fromWhen,
      message: input.message,
      ipAddress,
    },
    select: { id: true },
  });

  return created;
}

/**
 * The office's side.
 *
 * ARCHIVED, NEVER DELETED — the same rule as every other record here. An
 * enquiry the farm decided not to pursue is still evidence of demand, and it is
 * the first thing anybody will want when they ask next year why supply was
 * committed the way it was.
 */

const include = {
  readBy: { select: { name: true } },
  respondedBy: { select: { name: true } },
} as const;

type DbEnquiry = {
  id: string;
  kind: EnquiryKind;
  name: string;
  phone: string;
  email: string | null;
  businessName: string | null;
  cratesPerWeek: number | null;
  fromWhen: string | null;
  message: string | null;
  createdAt: Date;
  readAt: Date | null;
  respondedAt: Date | null;
  responseNote: string | null;
  archivedAt: Date | null;
  readBy: { name: string } | null;
  respondedBy: { name: string } | null;
};

function toEnquiry(row: DbEnquiry): Enquiry {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    phone: row.phone,
    email: row.email,
    businessName: row.businessName,
    cratesPerWeek: row.cratesPerWeek,
    fromWhen: row.fromWhen,
    message: row.message,
    createdAt: row.createdAt,
    readAt: row.readAt,
    readByName: row.readBy?.name ?? null,
    respondedAt: row.respondedAt,
    respondedByName: row.respondedBy?.name ?? null,
    responseNote: row.responseNote,
    archivedAt: row.archivedAt,
  };
}

/**
 * The enquiries a screen shows.
 *
 * ARCHIVED TODAY STAYS VISIBLE, the same rule as incidents and tasks. An item
 * that vanishes the instant it is put aside reads to the person who just did it
 * as "did that work?", and leaves anybody who archived the wrong one hunting
 * through a filter to undo it.
 */
export async function listEnquiries(
  principal: Principal,
  options: { includeArchived?: boolean; asOf?: Date } = {},
): Promise<Enquiry[]> {
  const asOf = options.asOf ?? new Date();
  const startOfToday = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
  );

  const rows = await db.enquiry.findMany({
    where: {
      ...orgFilter(principal),
      ...(options.includeArchived
        ? {}
        : { OR: [{ archivedAt: null }, { archivedAt: { gte: startOfToday } }] }),
    },
    orderBy: { createdAt: 'desc' },
    include,
  });

  return rows.map((r) => toEnquiry(r as unknown as DbEnquiry));
}

export async function enquiryById(
  principal: Principal,
  enquiryId: string,
): Promise<Enquiry | null> {
  const row = await db.enquiry.findFirst({
    where: { id: enquiryId, ...orgFilter(principal) },
    include,
  });
  return row ? toEnquiry(row as unknown as DbEnquiry) : null;
}

/**
 * Record that somebody has opened it.
 *
 * NOT AUTOMATIC ON RENDER. Marking every enquiry read the moment the list loads
 * would make the "read" state meaningless — everything would be read and
 * nothing would ever be new — and would quietly erase the one signal that says
 * a message went unopened. It is a click, because it is a claim.
 *
 * Idempotent: the first person to open it is the one recorded, and a second
 * click does not overwrite them.
 */
export async function markRead(
  principal: Principal,
  enquiryId: string,
): Promise<{ name: string }> {
  const existing = await enquiryById(principal, enquiryId);
  if (!existing) throw new EnquiryError('That enquiry no longer exists.');
  if (existing.readAt) return { name: existing.name };

  await db.enquiry.update({
    where: { id: enquiryId },
    data: { readAt: new Date(), readById: principal.userId },
  });
  return { name: existing.name };
}

/**
 * Record that somebody has replied, and what they said.
 *
 * THE NOTE IS REQUIRED. It carries the price that was quoted, which is the one
 * thing nobody will be able to reconstruct when the buyer rings back in March.
 */
export async function markAnswered(
  principal: Principal,
  enquiryId: string,
  note: string,
): Promise<{ name: string }> {
  const existing = await enquiryById(principal, enquiryId);
  if (!existing) throw new EnquiryError('That enquiry no longer exists.');

  const problems = answerErrors(note);
  if (problems.length > 0) throw new EnquiryError(problems[0]);

  await db.enquiry.update({
    where: { id: enquiryId },
    data: {
      respondedAt: new Date(),
      respondedById: principal.userId,
      responseNote: note.trim(),
      // Answering implies reading. Somebody who replied without clicking "seen"
      // has plainly seen it, and leaving readAt null would keep it counted as
      // unopened for ever.
      ...(existing.readAt ? {} : { readAt: new Date(), readById: principal.userId }),
    },
  });
  return { name: existing.name };
}

/**
 * Put one aside.
 *
 * ALLOWED WITHOUT ANSWERING, unlike closing an incident. Some enquiries do not
 * deserve a reply — a supplier pitching, somebody in another region — and
 * forcing a note on those would teach people to type "n/a" and then to type it
 * on the ones that mattered too.
 */
export async function archiveEnquiry(
  principal: Principal,
  enquiryId: string,
): Promise<{ name: string }> {
  const existing = await enquiryById(principal, enquiryId);
  if (!existing) throw new EnquiryError('That enquiry no longer exists.');
  if (existing.archivedAt) throw new EnquiryError('That is already put aside.');

  await db.enquiry.update({
    where: { id: enquiryId },
    data: { archivedAt: new Date(), archivedById: principal.userId },
  });
  return { name: existing.name };
}
