import { describe, it, expect } from 'vitest';
import {
  stateOf,
  daysWaiting,
  isUnanswered,
  UNANSWERED_AFTER_DAYS,
  sortEnquiries,
  enquirySentence,
  wantsSentence,
  answerErrors,
  enquirySummary,
  type Enquiry,
} from '@/lib/enquiries';

const DAY = 86_400_000;
const NOW = new Date('2026-09-10T09:00:00.000Z');

function enquiry(over: Partial<Enquiry> = {}): Enquiry {
  return {
    id: over.id ?? 'e1',
    kind: over.kind ?? 'WHOLESALE',
    name: over.name ?? 'Akosua Mensah',
    phone: over.phone ?? '+233245551234',
    email: over.email ?? null,
    businessName: over.businessName ?? null,
    cratesPerWeek: over.cratesPerWeek ?? null,
    fromWhen: over.fromWhen ?? null,
    message: over.message ?? null,
    createdAt: over.createdAt ?? NOW,
    readAt: over.readAt ?? null,
    readByName: over.readByName ?? null,
    respondedAt: over.respondedAt ?? null,
    respondedByName: over.respondedByName ?? null,
    responseNote: over.responseNote ?? null,
    archivedAt: over.archivedAt ?? null,
  };
}

describe('the state of an enquiry', () => {
  it('starts as new', () => {
    expect(stateOf(enquiry())).toBe('NEW');
  });

  // READING AND ANSWERING ARE SEPARATE ACTS. Collapsing them lets an enquiry go
  // from arrived to finished with nobody having spoken to the person.
  it('SEPARATES BEING READ FROM BEING ANSWERED', () => {
    expect(stateOf(enquiry({ readAt: NOW }))).toBe('READ');
    expect(stateOf(enquiry({ readAt: NOW, respondedAt: NOW }))).toBe('ANSWERED');
  });

  it('puts archived above everything', () => {
    expect(stateOf(enquiry({ respondedAt: NOW, archivedAt: NOW }))).toBe('ARCHIVED');
  });
});

describe('going unanswered', () => {
  const old = (days: number) => enquiry({ createdAt: new Date(NOW.getTime() - days * DAY) });

  it('counts from when it arrived', () => {
    expect(daysWaiting(old(3), NOW)).toBe(3);
    expect(daysWaiting(enquiry(), NOW)).toBe(0);
  });

  it('does not report a negative wait', () => {
    expect(daysWaiting(enquiry({ createdAt: new Date(NOW.getTime() + DAY) }), NOW)).toBe(0);
  });

  it('fires at the threshold', () => {
    expect(isUnanswered(old(UNANSWERED_AFTER_DAYS - 1), NOW)).toBe(false);
    expect(isUnanswered(old(UNANSWERED_AFTER_DAYS), NOW)).toBe(true);
  });

  // READING IS NOT ANSWERING. A clock that restarted on being read would let an
  // enquiry be opened daily and never replied to.
  it('IS NOT SATISFIED BY SOMEBODY MERELY OPENING IT', () => {
    const seen = { ...old(5), readAt: NOW, readByName: 'Owner' };
    expect(isUnanswered(seen, NOW)).toBe(true);
  });

  it('stops once answered or put aside', () => {
    expect(isUnanswered({ ...old(5), respondedAt: NOW }, NOW)).toBe(false);
    expect(isUnanswered({ ...old(5), archivedAt: NOW }, NOW)).toBe(false);
  });
});

describe('the order they are shown in', () => {
  // NOT SORTED BY SIZE. That figure is what somebody typed before they had a
  // price, and a farm that visibly answers the big ones first is a farm the
  // small ones stop writing to.
  it('DOES NOT PUT THE BIGGEST BUYER FIRST', () => {
    const small = enquiry({
      id: 'small',
      cratesPerWeek: 2,
      createdAt: new Date(NOW.getTime() - 4 * DAY),
    });
    const large = enquiry({ id: 'large', cratesPerWeek: 200, createdAt: NOW });
    expect(sortEnquiries([large, small], NOW).map((e) => e.id)).toEqual(['small', 'large']);
  });

  it('floats anything unanswered to the top', () => {
    const answered = enquiry({
      id: 'answered',
      createdAt: new Date(NOW.getTime() - 6 * DAY),
      respondedAt: NOW,
    });
    const waiting = enquiry({ id: 'waiting', createdAt: new Date(NOW.getTime() - 3 * DAY) });
    const fresh = enquiry({ id: 'fresh', createdAt: NOW });
    expect(sortEnquiries([answered, fresh, waiting], NOW).map((e) => e.id)).toEqual([
      'waiting',
      'fresh',
      'answered',
    ]);
  });

  it('sinks the ones put aside', () => {
    const aside = enquiry({ id: 'aside', archivedAt: NOW });
    const open = enquiry({ id: 'open', createdAt: NOW });
    expect(sortEnquiries([aside, open], NOW).map((e) => e.id)).toEqual(['open', 'aside']);
  });
});

describe('what the row says', () => {
  it('names the cost of waiting rather than counting days', () => {
    const sentence = enquirySentence(
      enquiry({ createdAt: new Date(NOW.getTime() - 4 * DAY) }),
      NOW,
    );
    expect(sentence).toMatch(/already chosen/i);
  });

  it('says who answered it', () => {
    expect(
      enquirySentence(enquiry({ respondedAt: NOW, respondedByName: 'Ama' }), NOW),
    ).toContain('Ama');
  });

  it('says plainly when nobody has opened it', () => {
    expect(enquirySentence(enquiry(), NOW)).toMatch(/Nobody has opened it/);
  });

  it('summarises what they asked for', () => {
    expect(wantsSentence(enquiry({ cratesPerWeek: 20, fromWhen: 'March' }))).toBe(
      'about 20 crates a week, from March',
    );
  });

  // A wholesale enquiry with no quantity is a real thing, and saying so is more
  // useful than an empty line.
  it('says when a wholesale buyer stated no quantity', () => {
    expect(wantsSentence(enquiry())).toBe('Quantity not stated');
    expect(wantsSentence(enquiry({ kind: 'GENERAL' }))).toBe('');
  });
});

describe('answering', () => {
  // THE PRICE QUOTED IS THE ONE THING NOBODY CAN RECONSTRUCT in March.
  it('REQUIRES SAYING WHAT WAS SAID', () => {
    expect(answerErrors('')).toHaveLength(1);
    expect(answerErrors('  ')).toHaveLength(1);
    expect(answerErrors('ok')).toHaveLength(1);
    expect(answerErrors('Quoted GHS 45 a crate')).toEqual([]);
  });

  it('says why, not just that it is required', () => {
    expect(answerErrors('')[0]).toMatch(/price/i);
  });
});

describe('the summary line', () => {
  it('says nothing has arrived yet', () => {
    expect(enquirySummary([], NOW)).toMatch(/Nothing yet/);
  });

  it('leads with what is late', () => {
    const late = enquiry({ createdAt: new Date(NOW.getTime() - 5 * DAY) });
    expect(enquirySummary([late, enquiry()], NOW)).toMatch(/^1 waiting 2 days or more/);
  });

  it('counts what is open when nothing is late', () => {
    expect(enquirySummary([enquiry(), enquiry({ id: 'e2' })], NOW)).toBe('2 to answer.');
  });

  it('says so when everything is dealt with', () => {
    expect(enquirySummary([enquiry({ respondedAt: NOW })], NOW)).toBe('All answered.');
  });
});
