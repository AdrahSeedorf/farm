import { BRAND } from '@/lib/brand';

/**
 * The public website — ADRAH Farms
 *
 * Pure. What the site is allowed to say, worked out from what the farm actually
 * has rather than from copy somebody typed months earlier.
 *
 * THE PROBLEM THIS MODULE EXISTS TO SOLVE
 *   A marketing site is written once and then stops being checked, while the
 *   business it describes keeps moving. A site that says "fresh eggs daily" five
 *   months before the first hen lays is not optimism, it is a false statement to
 *   a customer, and the first person who drives out to buy a crate and finds
 *   pullets is a customer the farm does not get back.
 *
 *   So the claims are DERIVED. The site says what is true of the farm today and
 *   changes on its own the morning that stops being true, with nobody editing a
 *   file and nobody redeploying.
 *
 * WHAT IT WILL NOT DO
 *   It will not print a phone number the farm has not confirmed. A placeholder
 *   in `brand.ts` is a number that rings nowhere, and a business card with the
 *   wrong number on it is worse than one with no number: the customer does not
 *   conclude "I should look this up", they conclude "these people are not real".
 *   Where a contact detail is unconfirmed the CTA is withheld and the enquiry
 *   form is offered instead.
 */

// ---------------------------------------------------------------------------
// WHAT THE FARM CAN HONESTLY SAY IT SELLS
// ---------------------------------------------------------------------------

/**
 * BEFORE FIRST LAY vs SELLING.
 *
 * Not a switch somebody flips. A farm with production recorded is selling; a
 * farm with birds but no production is coming; a farm with neither is being
 * built. The site reads the same ledgers the office does.
 */
export type SupplyState = 'BEING_BUILT' | 'BEFORE_FIRST_LAY' | 'SELLING';

export interface SupplyInput {
  /** Open animal groups the farm has placed. */
  flocks: number;
  /** Anything collected in the recent window. Not a lifetime total. */
  recentProduction: number;
  /**
   * The earliest date any placed flock is expected to reach point of lay,
   * derived from its hatch date and the production type's own figure. Null when
   * nothing is placed, or when the production type states no such figure —
   * which is a real answer, and better than a date invented to fill the gap.
   */
  expectedFirstLay: Date | null;
}

export function supplyStateOf(input: SupplyInput): SupplyState {
  if (input.recentProduction > 0) return 'SELLING';
  if (input.flocks > 0) return 'BEFORE_FIRST_LAY';
  return 'BEING_BUILT';
}

/**
 * How far off first lay is, in whole weeks.
 *
 * WEEKS, NOT A DATE. "From late January" is a promise a farm can keep; "on 24
 * January" is one nobody can, because a flock comes into lay over a fortnight
 * and the weather has a vote. Rounding up is deliberate — a week early is a
 * disappointed buyer, a week late is a pleasant surprise.
 */
export function weeksUntil(expected: Date | null, asOf: Date = new Date()): number | null {
  if (!expected) return null;
  const ms = expected.getTime() - asOf.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (7 * 86_400_000));
}

/**
 * The month a customer can plan around, in the farm's own words.
 *
 * "Early", "mid" or "late" rather than a day, for the same reason as above.
 */
export function supplyMonth(expected: Date | null): string | null {
  if (!expected) return null;
  const day = expected.getUTCDate();
  const part = day <= 10 ? 'early' : day <= 20 ? 'mid' : 'late';
  const month = expected.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  return `${part} ${month}`;
}

/**
 * The single sentence under the headline.
 *
 * Written here rather than in the page so the wording is testable and identical
 * everywhere it appears — the hero, the products page and the meta description
 * must not drift into three different promises.
 */
export function supplySentence(
  state: SupplyState,
  expected: Date | null,
  asOf: Date = new Date(),
): string {
  if (state === 'SELLING') {
    return 'Table eggs, collected and graded every morning. Wholesale and retail, farm collection or delivery.';
  }

  if (state === 'BEFORE_FIRST_LAY') {
    const month = supplyMonth(expected);
    const weeks = weeksUntil(expected, asOf);

    if (month && weeks !== null && weeks > 0) {
      return `Our first flock is in rearing. Table eggs from ${month} — about ${weeks} ${weeks === 1 ? 'week' : 'weeks'} away. We are taking wholesale enquiries now.`;
    }
    if (month) {
      return `Our first flock is coming into lay. Table eggs from ${month}. We are taking wholesale enquiries now.`;
    }
    return 'Our first flock is in rearing. We are taking wholesale enquiries now, ahead of our first eggs.';
  }

  return `${BRAND.name} is being set up in ${BRAND.location.region || BRAND.location.country}. We are taking wholesale enquiries now.`;
}

/**
 * The headline itself.
 *
 * A FARM THAT CANNOT YET SELL DOES NOT LEAD WITH A SALES LINE. Leading with
 * "Fresh eggs, daily" before there are any is the exact false claim this module
 * exists to prevent, and it is the line most likely to be believed because it is
 * the biggest text on the page.
 */
export function headlineFor(state: SupplyState): string {
  if (state === 'SELLING') return BRAND.tagline;
  return 'Eggs from a farm you can visit';
}

// ---------------------------------------------------------------------------
// WHAT THE SITE MAY PUBLISH ABOUT CONTACTING THE FARM
// ---------------------------------------------------------------------------

/**
 * Is this a real number, or the placeholder `brand.ts` ships with?
 *
 * A DELIBERATELY DUMB CHECK. It looks for the run of zeros in the seeded value
 * and for anything too short to be a Ghanaian mobile. It is not trying to
 * validate that the line is answered — it is trying to make sure the site never
 * publishes a number nobody chose, which is the only failure mode that matters
 * here and the one that happens by forgetting rather than by malice.
 */
export function isPlaceholderPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 11) return true;
  if (/0{6,}/.test(digits)) return true;
  return false;
}

export interface PublicContact {
  /** Show CALL TO ORDER. */
  canCall: boolean;
  /** Show ORDER ON WHATSAPP. */
  canWhatsApp: boolean;
  /** Show the email address. */
  canEmail: boolean;
  /** Say where the farm is. */
  hasLocation: boolean;
  /**
   * What is still missing, for the farm's own eyes. Rendered only to a signed-in
   * owner, never to the public — a page that lists its own gaps to a customer is
   * telling them the business is half-built.
   */
  missing: string[];
}

export function publicContact(): PublicContact {
  const canCall = !isPlaceholderPhone(BRAND.contact.salesPhone);
  const canWhatsApp = !isPlaceholderPhone(BRAND.contact.whatsappPhone);
  const hasLocation = BRAND.location.town.trim().length > 0;

  const missing: string[] = [];
  if (!canCall) missing.push('a sales phone number');
  if (!canWhatsApp) missing.push('a WhatsApp number');
  if (!hasLocation) missing.push('the farm’s town and district');

  return {
    canCall,
    canWhatsApp,
    canEmail: BRAND.contact.email.trim().length > 0,
    hasLocation,
    missing,
  };
}

/** Where the farm is, as much of it as has been confirmed. */
export function locationLine(): string {
  const { town, district, region, country } = BRAND.location;
  return [town, district, region, country].filter((p) => p && p.trim().length > 0).join(', ');
}

// ---------------------------------------------------------------------------
// HOW ORDERING WORKS
// ---------------------------------------------------------------------------

export interface OrderStep {
  title: string;
  detail: string;
}

/**
 * The three steps, which change with what the farm can actually do.
 *
 * NO PAYMENT STEP IS DESCRIBED, at any state. How a customer pays has not been
 * decided — the provider question is still open — and describing a payment
 * method the farm cannot take is the same false-promise failure as the headline.
 * The steps stop at "we confirm", which is true today and stays true whatever is
 * chosen later.
 */
export function orderSteps(state: SupplyState, contact: PublicContact): OrderStep[] {
  const reach = contact.canWhatsApp
    ? 'Message us on WhatsApp'
    : contact.canCall
      ? 'Call us'
      : 'Send us an enquiry';

  if (state === 'SELLING') {
    return [
      {
        title: `${reach} with what you need`,
        detail: 'Crates or trays, and the day you want them. No account, no app.',
      },
      {
        title: 'We confirm the price and the day',
        detail: 'You get a written confirmation with the total before anything is packed.',
      },
      {
        title: 'Collect from the farm, or we deliver',
        detail: 'Collection any morning. Delivery by arrangement.',
      },
    ];
  }

  return [
    {
      title: `${reach} with what you expect to need`,
      detail: 'How many crates a week, and from when. Nothing is committed on either side.',
    },
    {
      title: 'We come back to you with terms',
      detail: 'What we expect to supply, and from which week.',
    },
    {
      title: 'You are first in line when we start',
      detail: 'Early supply goes to buyers who talked to us before the first egg.',
    },
  ];
}
