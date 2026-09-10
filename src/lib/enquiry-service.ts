import 'server-only';
import { db } from '@/lib/db';
import { toE164Ghana } from '@/lib/brand';
import type { EnquiryInput } from '@/lib/validation/enquiry';

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
 * The office's side: enquiries somebody still has to answer.
 *
 * ARCHIVED, NEVER DELETED — the same rule as every other record here. An
 * enquiry the farm decided not to pursue is still evidence of demand, and it is
 * the first thing anybody will want when they ask next year why supply was
 * committed the way it was.
 */
export async function listEnquiries(
  organisationId: string,
  options: { includeArchived?: boolean } = {},
) {
  return db.enquiry.findMany({
    where: {
      organisationId,
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ respondedAt: 'asc' }, { createdAt: 'desc' }],
    include: {
      readBy: { select: { name: true } },
      respondedBy: { select: { name: true } },
    },
  });
}
