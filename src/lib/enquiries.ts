/**
 * Enquiries — ADRAH Farms
 *
 * Somebody came looking. Pure; no database.
 *
 * THE ONLY NUMBER THIS MODULE HAS IS HOW MANY GET ANSWERED, and the farm is
 * about to spend five months with this as its only sales channel. A wholesale
 * enquiry that sits for a week is not a slow reply — it is a buyer who has
 * already rung somebody else, and neither the farm nor this software will ever
 * find out that it happened. So the whole module is arranged around making an
 * unanswered one impossible to miss.
 *
 * READING AND ANSWERING ARE SEPARATE ACTS, deliberately, the same way a report
 * being looked at is separate from it being closed. "Somebody has seen this"
 * and "somebody has replied" are different facts, and collapsing them lets an
 * enquiry go from arrived to finished with nobody having spoken to the person.
 *
 * NOTHING IS EVER DELETED. An enquiry the farm decided not to pursue is still
 * evidence of demand, and it is the first thing anybody will want when they ask
 * next year why supply was committed the way it was.
 */

export const ENQUIRY_KINDS = ['WHOLESALE', 'GENERAL'] as const;
export type EnquiryKind = (typeof ENQUIRY_KINDS)[number];

export const KIND_LABELS: Record<EnquiryKind, string> = {
  WHOLESALE: 'Wholesale',
  GENERAL: 'General',
};

export interface Enquiry {
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
  readByName: string | null;
  respondedAt: Date | null;
  respondedByName: string | null;
  responseNote: string | null;
  archivedAt: Date | null;
}

export type EnquiryState = 'NEW' | 'READ' | 'ANSWERED' | 'ARCHIVED';

export function stateOf(enquiry: Enquiry): EnquiryState {
  if (enquiry.archivedAt) return 'ARCHIVED';
  if (enquiry.respondedAt) return 'ANSWERED';
  if (enquiry.readAt) return 'READ';
  return 'NEW';
}

/**
 * How long an enquiry may go unanswered before the farm is told about it.
 *
 * TWO DAYS, AND IT IS NOT A SERVICE-LEVEL TARGET. It is the point past which a
 * wholesale buyer has stopped waiting. Somebody comparing suppliers sends the
 * same message to three farms on a Monday; the one that replies on Wednesday is
 * replying to a decision already made.
 *
 * Counted from when it ARRIVED, not from when somebody read it — reading it is
 * not an answer, and a rule that restarted on being read would let an enquiry be
 * opened daily and never replied to.
 */
export const UNANSWERED_AFTER_DAYS = 2;

export function daysWaiting(enquiry: Enquiry, asOf: Date = new Date()): number {
  const ms = asOf.getTime() - enquiry.createdAt.getTime();
  return ms < 0 ? 0 : Math.floor(ms / 86_400_000);
}

export function isUnanswered(enquiry: Enquiry, asOf: Date = new Date()): boolean {
  const state = stateOf(enquiry);
  if (state === 'ANSWERED' || state === 'ARCHIVED') return false;
  return daysWaiting(enquiry, asOf) >= UNANSWERED_AFTER_DAYS;
}

/**
 * Newest first, EXCEPT that anything still unanswered floats to the top.
 *
 * NOT SORTED BY SIZE. A twenty-crate enquiry outranking a two-crate one is the
 * obvious rule and the wrong one: the figure on the form is what somebody typed
 * before they had a price, the small shop that buys every week for three years
 * is worth more than the hotel that asked once, and a farm that visibly answers
 * the big ones first is a farm the small ones stop writing to.
 */
export function sortEnquiries(enquiries: Enquiry[], asOf: Date = new Date()): Enquiry[] {
  const rank = (e: Enquiry) => {
    if (isUnanswered(e, asOf)) return 0;
    const state = stateOf(e);
    if (state === 'NEW') return 1;
    if (state === 'READ') return 2;
    if (state === 'ANSWERED') return 3;
    return 4;
  };

  return [...enquiries].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    // Within a rank, the one that has been waiting longest.
    if (rank(a) <= 2) return a.createdAt.getTime() - b.createdAt.getTime();
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

/** A line the person answering can act on. */
export function enquirySentence(enquiry: Enquiry, asOf: Date = new Date()): string {
  const state = stateOf(enquiry);
  const days = daysWaiting(enquiry, asOf);
  const waited = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;

  if (state === 'ARCHIVED') return `Put aside. Came in ${waited}.`;
  if (state === 'ANSWERED') {
    return `Answered by ${enquiry.respondedByName ?? 'somebody'}. Came in ${waited}.`;
  }
  if (isUnanswered(enquiry, asOf)) {
    return `Waiting ${days} days for a reply. Somebody comparing suppliers has already chosen.`;
  }
  if (state === 'READ') return `Seen by ${enquiry.readByName ?? 'somebody'}, not yet answered.`;
  return `Came in ${waited}. Nobody has opened it.`;
}

/** What they said they want, in one line, for a list row. */
export function wantsSentence(enquiry: Enquiry): string {
  const parts: string[] = [];
  if (enquiry.cratesPerWeek !== null) {
    parts.push(`about ${enquiry.cratesPerWeek} crates a week`);
  }
  if (enquiry.fromWhen) parts.push(`from ${enquiry.fromWhen}`);
  if (parts.length === 0) return enquiry.kind === 'WHOLESALE' ? 'Quantity not stated' : '';
  return parts.join(', ');
}

/**
 * Answering requires saying what was said.
 *
 * THE SAME RULE AS CLOSING AN INCIDENT, for the same reason. An enquiry marked
 * answered with nothing recorded is one somebody made disappear — and here it
 * also loses the price that was quoted, which is the single most expensive thing
 * to have to guess at when the buyer rings back in March.
 */
export function answerErrors(note: string): string[] {
  if (note.trim().length < 3) {
    return [
      'Say what you told them — the price you quoted especially. In March, when they ring back, this is the only record of it.',
    ];
  }
  return [];
}

export function enquirySummary(enquiries: Enquiry[], asOf: Date = new Date()): string {
  const open = enquiries.filter((e) => {
    const state = stateOf(e);
    return state === 'NEW' || state === 'READ';
  });
  const late = enquiries.filter((e) => isUnanswered(e, asOf));

  if (enquiries.length === 0) {
    return 'Nothing yet. Enquiries from the website land here.';
  }
  if (late.length > 0) {
    return `${late.length} waiting ${UNANSWERED_AFTER_DAYS} days or more for a reply${
      open.length > late.length ? `, ${open.length} open in total` : ''
    }.`;
  }
  if (open.length > 0) {
    return `${open.length} to answer.`;
  }
  return 'All answered.';
}
