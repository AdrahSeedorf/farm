/**
 * The draft programme — ADRAH Farms
 *
 * A SKELETON TO TAKE TO A VET, NOT A SCHEDULE TO FOLLOW.
 *
 * This system refuses to author a vaccination schedule, and that refusal is
 * worth restating because this file looks like the opposite of it:
 *
 *   - the hatchery has already vaccinated the chicks, and which vaccines they
 *     gave, at what age, is a fact about one specific batch of birds;
 *   - Gumboro timing depends on maternal antibody levels inherited from the
 *     parent flock, which nothing here can know;
 *   - Newcastle challenge pressure is local to Adansi South;
 *   - and withdrawal periods end up in a customer's food.
 *
 * So what this provides is the SHAPE of the conversation, not its content: the
 * diseases a layer flock in Ghana is normally protected against, in the order
 * they normally come up, with every medical decision left blank and every row
 * marked unverified.
 *
 * WHAT IS DELIBERATELY BLANK, AND WHY IT IS SAFE TO LEAVE IT SO
 *
 *   `eggWithdrawalDays` and `meatWithdrawalDays` are null on every item. Since
 *   the unstated-withdrawal rule, null means UNKNOWN and restricts selling
 *   outright — so a flock treated from this draft cannot have its eggs sold
 *   until somebody reads a label and records what it says. The blank is not an
 *   omission waiting to be noticed; it is a lock.
 *
 *   `ageDays` carries a typical figure because a schedule with no ages is not a
 *   document anybody can discuss. Every item says in its notes that the age is
 *   unconfirmed, and the programme stays DRAFT until a named person approves it.
 *
 * NOTHING HERE IS A RECOMMENDATION. It is a list of questions wearing the shape
 * of a schedule.
 */

export const DRAFT_PROGRAMME_NAME = 'Draft — to be confirmed with a vet';

export const DRAFT_SOURCE_NOTE =
  'Unverified draft. Not authored by a vet and not approved by anybody. Every age is typical rather than prescribed, and no withdrawal period has been recorded — which means produce from a treated house cannot be sold until somebody reads the label. Take this to your chick supplier and the District Veterinary Officer.';

export interface DraftItem {
  /** What a vet would call it. */
  name: string;
  /** Typical age in days. UNCONFIRMED — the point of the conversation. */
  ageDays: number;
  eventType: 'VACCINATION' | 'MEDICATION' | 'SUPPLEMENT' | 'TREATMENT';
  /** Why it is on the list at all, and what to ask about it. */
  ask: string;
}

/**
 * The diseases a layer flock in Ghana is normally protected against.
 *
 * ORDERED BY AGE, because that is the order they will be discussed in. The ages
 * are the typical windows published in layer management guides; they are a
 * starting point for a conversation and are marked as such on every row.
 */
export const DRAFT_ITEMS: readonly DraftItem[] = [
  {
    name: 'Marek’s disease',
    ageDays: 0,
    eventType: 'VACCINATION',
    ask: 'Given at the hatchery on the day of hatch, almost always. Ask your chick supplier to confirm it was given and to put it in writing — if it was, this is a record rather than a plan.',
  },
  {
    name: 'Newcastle disease — first dose',
    ageDays: 7,
    eventType: 'VACCINATION',
    ask: 'Ask the District Veterinary Officer what Newcastle pressure is like around Adansi South, which strain to use, and whether the hatchery already gave one.',
  },
  {
    name: 'Infectious bronchitis',
    ageDays: 7,
    eventType: 'VACCINATION',
    ask: 'Often combined with the first Newcastle dose. Ask whether a combined vaccine is what your supplier stocks.',
  },
  {
    name: 'Gumboro (infectious bursal disease) — first dose',
    ageDays: 14,
    eventType: 'VACCINATION',
    ask: 'THE TIMING OF THIS ONE CANNOT BE GUESSED. It depends on the antibodies the chicks inherited from the parent flock. Ask the hatchery for the parent flock’s details and ask the vet when to give it.',
  },
  {
    name: 'Gumboro — second dose',
    ageDays: 24,
    eventType: 'VACCINATION',
    ask: 'Whether a second dose is needed, and when, follows from the answer to the first.',
  },
  {
    name: 'Newcastle disease — second dose',
    ageDays: 28,
    eventType: 'VACCINATION',
    ask: 'Ask about the interval and whether a booster programme continues through lay.',
  },
  {
    name: 'Fowl pox',
    ageDays: 42,
    eventType: 'VACCINATION',
    ask: 'Mosquito-borne, so local conditions decide whether it is needed at all. Ask the vet.',
  },
  {
    name: 'Fowl typhoid',
    ageDays: 56,
    eventType: 'VACCINATION',
    ask: 'Ask whether it is used in your area and what the schedule is.',
  },
  {
    name: 'Deworming',
    ageDays: 70,
    eventType: 'MEDICATION',
    ask: 'ASK FOR THE EGG WITHDRAWAL PERIOD IN WRITING. Wormers are the treatment most likely to have one, and this system will not let eggs be sold from a treated house until it is recorded.',
  },
  {
    name: 'Infectious coryza',
    ageDays: 84,
    eventType: 'VACCINATION',
    ask: 'Ask whether it is used locally and when.',
  },
  {
    name: 'Newcastle disease — pre-lay booster',
    ageDays: 112,
    eventType: 'VACCINATION',
    ask: 'Ask what the booster interval through lay should be, and whether it changes during an outbreak season.',
  },
];

/**
 * The questions that are not about any one item.
 *
 * These are the ones that change the whole schedule, and the ones a farm
 * usually forgets to ask until something has gone wrong.
 */
export const GENERAL_QUESTIONS: readonly { question: string; why: string }[] = [
  {
    question: 'Exactly which vaccines did the hatchery already give, and at what age?',
    why: 'A schedule that repeats what was given is waste; one that omits it leaves a hole. This is a fact about your birds that only the supplier has.',
  },
  {
    question: 'What parent flock did the chicks come from, and what is its vaccination history?',
    why: 'Gumboro timing depends on the antibodies the chicks inherited. Without this the first dose is a guess.',
  },
  {
    question: 'Which diseases are actually a problem around New Edubiase and Adansi South?',
    why: 'Challenge pressure is local. A schedule copied from elsewhere protects against the wrong things.',
  },
  {
    question: 'For every product: what is the egg withdrawal period, in days, on the label?',
    why: 'This system refuses to sell eggs from a treated house until this is recorded. Zero is a valid answer — but it has to be an answer, not a blank.',
  },
  {
    question: 'Who should be recorded as having approved this programme, and in what role?',
    why: 'The system records a named person and their role against an approved schedule, so that months later it is clear whose judgement it was.',
  },
  {
    question: 'What should we do, and who should we ring, if birds start dying unexpectedly?',
    why: 'Worth agreeing before it happens rather than during.',
  },
];

/** One line per item, for a sheet somebody fills in by hand. */
export function blankFields(): readonly string[] {
  return [
    'Vaccine or product (exact name)',
    'Age in days',
    'Route (eye drop, drinking water, injection…)',
    'Dose per bird',
    'Egg withdrawal (days — write 0 if none)',
    'Meat withdrawal (days — write 0 if none)',
  ];
}

export function draftItemNote(item: DraftItem): string {
  return `UNCONFIRMED. ${item.ask}`;
}

/** Said at the top of every screen that shows this programme. */
export function draftWarning(): string {
  return 'This is a draft nobody has approved. The ages are typical rather than prescribed, and no withdrawal periods have been recorded — so produce from any house treated under it cannot be sold until a label has been read and recorded.';
}
