import { describe, it, expect } from 'vitest';
import {
  DRAFT_PROGRAMME_NAME,
  DRAFT_SOURCE_NOTE,
  DRAFT_ITEMS,
  GENERAL_QUESTIONS,
  blankFields,
  draftItemNote,
  draftWarning,
} from '@/lib/draft-programme';

describe('the draft programme', () => {
  /**
   * THE WHOLE POINT. This system refuses to author a vaccination schedule; what
   * it provides is the shape of the conversation. Every one of these assertions
   * is a line that must not be crossed later by somebody "filling in the gaps".
   */
  it('IS NAMED AS A DRAFT, SO NOBODY MISTAKES IT FOR A SCHEDULE', () => {
    expect(DRAFT_PROGRAMME_NAME.toLowerCase()).toContain('draft');
    expect(DRAFT_PROGRAMME_NAME.toLowerCase()).toContain('vet');
  });

  it('says in its own description that nobody authored or approved it', () => {
    expect(DRAFT_SOURCE_NOTE).toMatch(/unverified/i);
    expect(DRAFT_SOURCE_NOTE).toMatch(/not authored by a vet/i);
    expect(DRAFT_SOURCE_NOTE).toMatch(/not approved by anybody/i);
  });

  it('and says the ages are typical rather than prescribed', () => {
    expect(DRAFT_SOURCE_NOTE).toMatch(/typical rather than prescribed/i);
    expect(draftWarning()).toMatch(/typical rather than prescribed/i);
  });

  /** A draft with no ages is not a document anybody can discuss. */
  it('carries an age for every item, in order', () => {
    expect(DRAFT_ITEMS.length).toBeGreaterThan(5);
    const ages = DRAFT_ITEMS.map((i) => i.ageDays);
    expect([...ages].sort((a, b) => a - b)).toEqual(ages);
    expect(ages[0]).toBe(0); // Marek's, at the hatchery
  });

  /** Every row is a question, and the note says so where somebody will read it. */
  it('EVERY ITEM CARRIES WHAT TO ASK ABOUT IT', () => {
    for (const item of DRAFT_ITEMS) {
      expect(item.ask.length, item.name).toBeGreaterThan(30);
      expect(draftItemNote(item), item.name).toMatch(/^UNCONFIRMED\. /);
    }
  });

  /**
   * The three things that genuinely cannot be known from here, each named on the
   * row it affects rather than buried in a preamble.
   */
  it('NAMES WHAT CANNOT BE GUESSED, ON THE ROW IT AFFECTS', () => {
    const gumboro = DRAFT_ITEMS.find((i) => i.name.startsWith('Gumboro'))!;
    expect(gumboro.ask).toMatch(/cannot be guessed/i);
    expect(gumboro.ask).toMatch(/parent flock/i);

    const mareks = DRAFT_ITEMS.find((i) => i.name.startsWith('Marek'))!;
    expect(mareks.ask).toMatch(/hatchery/i);

    const newcastle = DRAFT_ITEMS.find((i) => i.name.includes('Newcastle'))!;
    expect(newcastle.ask).toMatch(/adansi south/i);
  });

  it('warns loudest on the treatment most likely to carry a withdrawal', () => {
    const worming = DRAFT_ITEMS.find((i) => i.name === 'Deworming')!;
    expect(worming.ask).toMatch(/egg withdrawal period in writing/i);
    expect(worming.eventType).toBe('MEDICATION');
  });
});

describe('the questions', () => {
  it('ask the hatchery the one thing only it knows', () => {
    expect(GENERAL_QUESTIONS.some((q) => /hatchery already give/i.test(q.question))).toBe(true);
    expect(GENERAL_QUESTIONS.some((q) => /parent flock/i.test(q.question))).toBe(true);
  });

  /** A zero is an answer; a blank is not, and the sale gate treats them differently. */
  it('ASK FOR THE WITHDRAWAL PERIOD, AND SAY THAT ZERO IS AN ANSWER', () => {
    const withdrawal = GENERAL_QUESTIONS.find((q) => /withdrawal period/i.test(q.question))!;
    expect(withdrawal.why).toMatch(/zero is a valid answer/i);
    expect(withdrawal.why).toMatch(/not a blank/i);

    const field = blankFields().find((f) => /egg withdrawal/i.test(f))!;
    expect(field).toMatch(/write 0 if none/i);
  });

  it('ask who is approving it, because the system records a name', () => {
    expect(GENERAL_QUESTIONS.some((q) => /approved this programme/i.test(q.question))).toBe(true);
  });

  it('every question says why it is being asked', () => {
    for (const q of GENERAL_QUESTIONS) {
      expect(q.why.length, q.question).toBeGreaterThan(30);
    }
  });

  /** Exactly the columns the schedule cannot work without, and nothing else. */
  it('the blank fields are the ones the system actually needs', () => {
    const fields = blankFields().join(' | ').toLowerCase();
    for (const needed of ['name', 'age in days', 'route', 'dose', 'egg withdrawal', 'meat withdrawal']) {
      expect(fields, needed).toContain(needed);
    }
  });
});
