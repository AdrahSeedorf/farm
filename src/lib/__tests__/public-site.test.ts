import { describe, it, expect } from 'vitest';
import {
  supplyStateOf,
  weeksUntil,
  supplyMonth,
  supplySentence,
  headlineFor,
  isPlaceholderPhone,
  orderSteps,
  type PublicContact,
} from '@/lib/public-site';

const NOW = new Date('2026-09-10T08:00:00.000Z');
const DAY = 86_400_000;

const reachable: PublicContact = {
  canCall: true,
  canWhatsApp: true,
  canEmail: true,
  hasLocation: true,
  missing: [],
};
const unreachable: PublicContact = {
  canCall: false,
  canWhatsApp: false,
  canEmail: true,
  hasLocation: false,
  missing: ['a sales phone number'],
};

describe('what the farm can honestly say it sells', () => {
  it('is selling once anything has been collected recently', () => {
    expect(
      supplyStateOf({ flocks: 2, recentProduction: 40, expectedFirstLay: null }),
    ).toBe('SELLING');
  });

  it('is before first lay with birds but nothing collected', () => {
    expect(
      supplyStateOf({ flocks: 2, recentProduction: 0, expectedFirstLay: new Date() }),
    ).toBe('BEFORE_FIRST_LAY');
  });

  it('is being built with no birds at all', () => {
    expect(
      supplyStateOf({ flocks: 0, recentProduction: 0, expectedFirstLay: null }),
    ).toBe('BEING_BUILT');
  });

  // THE CLAIM THIS WHOLE MODULE EXISTS TO PREVENT. "Fresh eggs, daily" five
  // months before the first hen lays is a false statement to a customer, and it
  // is the biggest text on the page.
  it('DOES NOT LEAD WITH A SALES LINE BEFORE THERE IS ANYTHING TO SELL', () => {
    expect(headlineFor('BEFORE_FIRST_LAY')).not.toMatch(/daily/i);
    expect(headlineFor('BEING_BUILT')).not.toMatch(/daily/i);
    expect(headlineFor('SELLING')).toMatch(/daily/i);
  });

  it('says how far off it is in weeks, rounded up', () => {
    // A week early is a disappointed buyer; a week late is a pleasant surprise.
    expect(weeksUntil(new Date(NOW.getTime() + 20 * DAY), NOW)).toBe(3);
    expect(weeksUntil(new Date(NOW.getTime() + 21 * DAY), NOW)).toBe(3);
    expect(weeksUntil(new Date(NOW.getTime() + 22 * DAY), NOW)).toBe(4);
  });

  it('never reports a negative wait', () => {
    expect(weeksUntil(new Date(NOW.getTime() - 30 * DAY), NOW)).toBe(0);
  });

  it('does not invent a date it does not have', () => {
    expect(weeksUntil(null, NOW)).toBeNull();
    expect(supplyMonth(null)).toBeNull();
  });

  // A MONTH, NOT A DAY. A flock comes into lay over a fortnight and the weather
  // has a vote, so "late January" is a promise a farm can keep.
  it('gives a part of a month rather than a date', () => {
    expect(supplyMonth(new Date('2027-01-05T00:00:00Z'))).toBe('early January');
    expect(supplyMonth(new Date('2027-01-15T00:00:00Z'))).toBe('mid January');
    expect(supplyMonth(new Date('2027-01-28T00:00:00Z'))).toBe('late January');
  });

  it('promises supply, not a date, in the sentence', () => {
    const sentence = supplySentence(
      'BEFORE_FIRST_LAY',
      new Date(NOW.getTime() + 60 * DAY),
      NOW,
    );
    expect(sentence).toMatch(/November/);
    expect(sentence).toMatch(/wholesale enquiries/i);
    expect(sentence).not.toMatch(/\d{1,2} November/);
  });

  it('still says something useful with no expected date', () => {
    const sentence = supplySentence('BEFORE_FIRST_LAY', null, NOW);
    expect(sentence).toMatch(/rearing/i);
    expect(sentence).toMatch(/wholesale enquiries/i);
  });
});

describe('what the site may publish about reaching the farm', () => {
  // A business card with the wrong number does not read as a mistake. It reads
  // as a business that is not real.
  it('SPOTS THE SEEDED PLACEHOLDER', () => {
    expect(isPlaceholderPhone('+233000000000')).toBe(true);
    expect(isPlaceholderPhone('+233000000')).toBe(true);
    expect(isPlaceholderPhone('')).toBe(true);
  });

  it('accepts a real Ghanaian mobile', () => {
    expect(isPlaceholderPhone('+233241234567')).toBe(false);
    expect(isPlaceholderPhone('+233 24 123 4567')).toBe(false);
  });

  it('does not reject a number merely for containing zeros', () => {
    expect(isPlaceholderPhone('+233201304567')).toBe(false);
  });
});

describe('how ordering works', () => {
  // NO PAYMENT STEP, AT ANY STATE. How a customer pays has not been decided, and
  // describing a method the farm cannot take is the same false promise as a
  // headline about eggs that do not exist.
  it('DESCRIBES NO PAYMENT METHOD', () => {
    for (const state of ['SELLING', 'BEFORE_FIRST_LAY', 'BEING_BUILT'] as const) {
      for (const contact of [reachable, unreachable]) {
        const words = orderSteps(state, contact)
          .map((s) => `${s.title} ${s.detail}`)
          .join(' ');
        expect(words, state).not.toMatch(/momo|mobile money|card|pay |payment|deposit/i);
      }
    }
  });

  it('always gives three steps', () => {
    expect(orderSteps('SELLING', reachable)).toHaveLength(3);
    expect(orderSteps('BEFORE_FIRST_LAY', unreachable)).toHaveLength(3);
  });

  it('names the channel that actually works', () => {
    expect(orderSteps('SELLING', reachable)[0].title).toMatch(/WhatsApp/);
    expect(orderSteps('SELLING', unreachable)[0].title).toMatch(/enquiry/i);
  });

  it('does not promise delivery before there is anything to deliver', () => {
    const words = orderSteps('BEFORE_FIRST_LAY', reachable)
      .map((s) => `${s.title} ${s.detail}`)
      .join(' ');
    expect(words).not.toMatch(/we deliver|collect from the farm/i);
    expect(words).toMatch(/nothing is committed/i);
  });
});
