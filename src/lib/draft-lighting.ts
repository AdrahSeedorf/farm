/**
 * A lighting programme to start an argument with — ADRAH Farms
 *
 * WHAT THIS IS. Eleven steps drawn from general layer practice for an ISA Brown
 * at about 6°N. It exists so the farm has something concrete to take to its
 * chick supplier and correct, rather than a blank screen and a vague sense that
 * lighting matters.
 *
 * WHAT IT IS NOT. It is not the ISA Brown management guide. It is not a
 * breeder's recommendation. Nobody with a qualification has looked at it, and
 * every screen it appears on says so. When the real guide arrives, the real
 * guide wins — it describes the actual bird, and this describes a reasonable
 * guess about her.
 *
 * ── THE ONE THING MOST LIKELY TO GO WRONG ──────────────────────────────────
 *
 * LIGHT STIMULATION GOES ON BODY WEIGHT, NOT ON AGE. These steps are written
 * against days because that is what the software knows, and that is their single
 * biggest weakness. A flock that reaches 15 weeks underweight and gets
 * stimulated anyway comes into lay small, lays small eggs, and prolapses. The
 * question sheet asks for the target weight first, before anything else, and
 * the screens repeat it. If the birds are light, the right move is to HOLD the
 * day where it is and keep feeding — not to follow this table.
 *
 * ── WHY THE REARING HALF IS SO EMPTY ───────────────────────────────────────
 *
 * Because at this latitude the sky already does it. A European programme spends
 * its rearing section on holding the day short and costs money in blackout; here
 * the natural day is about twelve hours all year, which is close to what a
 * growing pullet wants. After the first week there is nothing to do until
 * stimulation. That is a real advantage of this location and it is worth the
 * farm knowing they have it.
 */

export const DRAFT_LIGHTING_NAME = 'Draft — to be confirmed with the hatchery';

export const DRAFT_LIGHTING_SOURCE =
  'Not from a breeder or a veterinarian. These figures are general layer practice for an ISA Brown at about 6°N, assembled as a starting point so there is something specific to correct. Replace them with the ISA Brown management guide for your parent stock as soon as you have it.';

export interface DraftLightingItem {
  ageDays: number;
  totalHours: number;
  lux: number | null;
  /** Why this step exists, in the farm's own terms. */
  note: string;
}

/**
 * The steps.
 *
 * LUX IS LEFT BLANK FROM DAY 105 ONWARDS, deliberately, even though a figure
 * could be written. The laying light level is the one that depends most on the
 * lamps actually bought and the height they are hung at, neither of which exists
 * yet. A blank says nobody has measured; a number would say somebody has.
 */
export const DRAFT_LIGHTING_ITEMS: readonly DraftLightingItem[] = [
  {
    ageDays: 0,
    totalHours: 22,
    lux: 30,
    note: 'Almost continuous light for the first two days so chicks find feed and water. Bright — this is the only stage where brightness matters more than cost.',
  },
  {
    ageDays: 3,
    totalHours: 18,
    lux: 30,
    note: 'Begin stepping down. Chicks that have found the feeders no longer need the whole night.',
  },
  {
    ageDays: 5,
    totalHours: 15,
    lux: 25,
    note: 'Still stepping down toward the natural day.',
  },
  {
    ageDays: 7,
    totalHours: 12,
    lux: 15,
    note: 'Natural daylight only, from here until stimulation. At this latitude the sky gives about 12 hours year-round, so from now until week 15 the lamps stay off and there is nothing to switch.',
  },
  {
    ageDays: 105,
    totalHours: 12.5,
    lux: 20,
    note: 'FIRST STIMULATION, week 15 — and only if the flock is on target weight. If the birds are light, hold here and keep feeding. Stimulating an underweight pullet is how you get small eggs and prolapse.',
  },
  {
    ageDays: 112,
    totalHours: 13,
    lux: 20,
    note: 'Week 16. Half an hour a week is the usual pace — slow enough for body weight to keep up.',
  },
  {
    ageDays: 119,
    totalHours: 13.5,
    lux: 20,
    note: 'Week 17. First eggs often appear around here.',
  },
  {
    ageDays: 126,
    totalHours: 14,
    lux: 20,
    note: 'Week 18.',
  },
  {
    ageDays: 133,
    totalHours: 14.5,
    lux: 25,
    note: 'Week 19. Brighter as the flock comes into production.',
  },
  {
    ageDays: 140,
    totalHours: 15,
    lux: 25,
    note: 'Week 20 — the full laying day. Some guides go on to 16 hours at peak; ask the hatchery whether theirs does.',
  },
  {
    ageDays: 210,
    totalHours: 15,
    lux: 25,
    note: 'Week 30 onwards: HOLD. This row changes nothing and exists to say so. The day must never be shortened while the flock is in lay — that is how a moult is induced, and it will cost eggs if it is not what you meant.',
  },
];

/**
 * What the software cannot work out, in the order it should be asked.
 *
 * THE FIRST ONE DECIDES EVERYTHING ELSE. If the house is open-sided — which most
 * are here — the programme can only ever ADD light, never reduce it, and the
 * first four rows above become aspirational rather than instructions.
 */
export const LIGHTING_QUESTIONS: readonly { question: string; why: string }[] = [
  {
    question: 'Is the laying house open-sided, or can it be darkened?',
    why: 'A lamp can lengthen a day. Nothing can shorten one except blacking the house out. In an open-sided house the shortest possible day is whatever the sky gives — about 12 hours — and any step below that cannot be followed.',
  },
  {
    question:
      'What does the ISA Brown guide for our parent stock say the lighting table should be?',
    why: 'This draft is a general-practice guess. The breeder measured the actual bird. Where the two disagree, the guide is right.',
  },
  {
    question:
      'What body weight should the flock reach at 15 weeks before we start adding light?',
    why: 'This is the single most important number on this sheet. Light stimulation goes on weight, not on age — stimulating a light flock gives small eggs and prolapse. Without this figure the week-15 row is a guess with a date on it.',
  },
  {
    question: 'How reliable is power here, and is there a generator?',
    why: 'Morning light before sunrise is the usual choice because the lamps switch off into daylight rather than into darkness. If power is unreliable at 04:00 but fine at 18:00, evening supplement may be the practical answer even though it needs a dimmer.',
  },
  {
    question: 'What lamps, at what wattage, hung at what height?',
    why: 'Lux is measured at bird height, and depends on the bulb, the height, the dust on it and the colour of the walls. Until this is answered the programme can say how LONG the lights are on, but not whether they are bright enough.',
  },
  {
    question: 'Do we have a light meter, or a phone that can act as one?',
    why: 'The lux figures in this draft are targets nobody has checked against this house. One reading at bird height, once, converts every one of them from a guess into a measurement.',
  },
];

/** Printed on the step sheet next to each row the vet or hatchery should correct. */
export function blankFields(): string[] {
  return [
    'Age (weeks / days) — confirm or correct',
    'Total hours of light per day',
    'Light level at bird height (lux)',
    'Anything that changes this for our house',
  ];
}

export function draftWarning(): string {
  return 'This programme has not been checked by a hatchery or a veterinarian. It is a starting point for a conversation, not a recommendation — and light stimulation should go on body weight, not on the ages below.';
}
