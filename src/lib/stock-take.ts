import { round } from '@/lib/metrics';
import type { Warning } from '@/lib/warnings';

/**
 * Stock takes — ADRAH Farms
 *
 * SOMEBODY COUNTS THE SHELF, AND THE LEDGER IS TOLD IT WAS WRONG.
 *
 * Everything else in this system derives stock from movements, and that is
 * right: there is no `quantityOnHand` column and there never will be. But a
 * ledger built only from what people remembered to record can only ever be as
 * honest as the recording. Eggs break, a tray goes to the house, a load is
 * counted twice. Until somebody physically counts, every figure on every screen
 * is the records agreeing with the records — which is exactly what the period
 * report says about itself, and this is the thing that fixes it.
 *
 * A COUNT AND AN ADJUSTMENT ARE TWO DIFFERENT FACTS.
 *
 *   The count is what a person saw: a number, a date, a name. It is evidence and
 *   it is never edited.
 *   The adjustment is what the ledger did about it: a movement, signed, with the
 *   count behind it.
 *
 *   Both are kept. A system that stored only the adjustment could not answer
 *   "who counted, and what did they actually see?" — which is the first question
 *   asked when stock goes missing, and the question an adjustment with no count
 *   behind it is designed to avoid.
 *
 * A COUNT THAT FINDS NOTHING IS STILL WORTH RECORDING. "When was this last
 * counted?" is a more useful question than most farms can answer, and a count
 * with no variance is the answer to it. Nothing is written to the ledger — there
 * is nothing to correct — but the count stands.
 *
 * THE VARIANCE IS NOT AN ERROR. It is a measurement of the gap between the
 * records and the world, and it is the only honest number in this file.
 */

// ---------------------------------------------------------------------------
// THE ARITHMETIC
// ---------------------------------------------------------------------------

export interface CountLine {
  itemId: string;
  itemName: string;
  unitKey: string;
  /**
   * What the ledger said at the moment of counting.
   *
   * SNAPSHOTTED, NOT RECOMPUTED. A receipt entered tomorrow, backdated to last
   * week, would change what the same sum returns — and then the variance this
   * count recorded would no longer be the variance it found. What the ledger
   * said when somebody was standing in the store is a fact about that moment.
   */
  expectedBase: number;
  /** What was actually on the shelf. Null while nobody has counted this one. */
  countedBase: number | null;
  /**
   * A key from `VARIANCE_CAUSES`. Required once a line is out, and meaningless
   * when it is not — a line that agreed has nothing to explain.
   */
  cause?: string | null;
  /** The detail a code cannot hold. The code is for counting; this is for remembering. */
  note?: string | null;
  /**
   * HOW TO SAY A QUANTITY TO THE PERSON WHO COUNTED IT.
   *
   * The arithmetic is all in base units — kilograms, pieces — because that is
   * what the ledger holds. The person is holding bags and crates. Without this,
   * a storekeeper who counted four bags instead of five was told "50 fewer Layer
   * mash than the records say", which reads like a disaster and is really one
   * bag. That was a real bug, found in the browser.
   *
   * Optional only so a test can work in base units without inventing a unit.
   * Every caller in the application supplies it.
   */
  display?: { unitName: string; factorToBase: number };
}

/**
 * A base-unit quantity, said in the unit the person counts in.
 *
 * Falls back to the bare number when no unit is given, rather than guessing a
 * name — an unlabelled number is merely terse, an invented label is wrong.
 */
export function say(line: CountLine, baseAmount: number): string {
  if (!line.display) return String(round(baseAmount, 3) ?? 0);
  const amount = round(baseAmount / line.display.factorToBase, 3) ?? 0;
  return `${amount} ${line.display.unitName}`;
}

/**
 * variance = counted − expected
 *
 * POSITIVE means there is MORE on the shelf than the records knew about: a
 * delivery nobody entered, or a collection recorded short.
 * NEGATIVE means there is LESS: breakage, an unrecorded issue, or something
 * taken.
 *
 * The sign is kept rather than reported as an absolute, because the two have
 * different causes and a farm chasing the wrong one wastes its time.
 */
export function varianceOf(line: Pick<CountLine, 'expectedBase' | 'countedBase'>): number | null {
  if (line.countedBase === null) return null;
  return round(line.countedBase - line.expectedBase, 2);
}

export function countedLines(lines: CountLine[]): CountLine[] {
  return lines.filter((l) => l.countedBase !== null);
}

/** Only lines where the shelf and the ledger actually disagree. */
export function discrepancies(lines: CountLine[]): CountLine[] {
  return countedLines(lines).filter((l) => varianceOf(l) !== 0);
}

export function totalVariance(lines: CountLine[]): number {
  return round(
    countedLines(lines).reduce((sum, l) => sum + (varianceOf(l) ?? 0), 0),
    2,
  ) ?? 0;
}

/**
 * How big the gap is as a share of what was expected.
 *
 * Null where the ledger expected nothing: a shelf holding twelve of something
 * the records had never heard of is not "infinitely wrong", it is a thing that
 * needs explaining, and a percentage would say neither.
 */
export function variancePct(line: CountLine): number | null {
  const variance = varianceOf(line);
  if (variance === null || line.expectedBase === 0) return null;
  return round((variance / line.expectedBase) * 100, 1);
}

// ---------------------------------------------------------------------------
// WHY IT WAS OUT
// ---------------------------------------------------------------------------

/**
 * A controlled vocabulary for the cause of a variance, for the same reason
 * `reason-codes.ts` exists: "broken", "Breakages", "some broke" are three
 * values describing one cause, and a year later nobody can count them.
 *
 * THIS IS THE FIELD THAT MAKES A STOCK TAKE WORTH DOING. A variance on its own
 * says the records are wrong. A variance with a cause says what to fix — and
 * twenty of them with the same cause says it loudly.
 *
 * SCOPED BY DIRECTION, because the causes genuinely differ. Nothing goes
 * missing by being delivered, and nothing appears by being dropped.
 *
 * "Nobody knows" is first in the short list and stays there. A counter forced
 * to pick a plausible cause will pick one, and an invented cause is worse than
 * an honest gap — it reads as evidence later.
 */
export interface VarianceCause {
  key: string;
  label: string;
  /** Which direction of variance this can explain. */
  appliesTo: 'SHORT' | 'OVER' | 'BOTH';
  hint?: string;
}

export const VARIANCE_CAUSES: readonly VarianceCause[] = [
  {
    key: 'unknown',
    label: 'Nobody knows',
    appliesTo: 'BOTH',
    hint: 'The honest answer when it is the true one. Do not guess — a guess becomes a fact on the next report.',
  },
  {
    key: 'breakage',
    label: 'Broken or spoiled, not written down',
    appliesTo: 'SHORT',
    hint: 'Breakage recorded properly at the time is a DAMAGE movement, not this.',
  },
  {
    key: 'unrecorded_issue',
    label: 'Taken out and never recorded',
    appliesTo: 'SHORT',
    hint: 'Feed carried to a house, eggs taken for the household, a sale written on paper.',
  },
  { key: 'miscount_earlier', label: 'An earlier count or entry was wrong', appliesTo: 'BOTH' },
  {
    key: 'unrecorded_receipt',
    label: 'Something arrived and was never entered',
    appliesTo: 'OVER',
    hint: 'Find the delivery note and enter the receipt instead if you can — that keeps the price.',
  },
  {
    key: 'collection_understated',
    label: 'More was collected than was written down',
    appliesTo: 'OVER',
  },
  {
    key: 'wrong_store',
    label: 'It was put in, or taken from, the wrong store',
    appliesTo: 'BOTH',
    hint: 'A transfer between stores is the proper fix. Use this only when the other store cannot be identified.',
  },
  {
    key: 'suspected_theft',
    label: 'Suspected theft',
    appliesTo: 'SHORT',
    hint: 'A serious thing to record. It is kept against your name and the date, and it is never edited away.',
  },
];

export function causesFor(variance: number): VarianceCause[] {
  const direction = variance < 0 ? 'SHORT' : 'OVER';
  return VARIANCE_CAUSES.filter((c) => c.appliesTo === 'BOTH' || c.appliesTo === direction);
}

export function isValidCause(key: string, variance: number): boolean {
  return causesFor(variance).some((c) => c.key === key);
}

export function causeLabel(key: string | null): string | null {
  if (!key) return null;
  return VARIANCE_CAUSES.find((c) => c.key === key)?.label ?? key;
}

// ---------------------------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------------------------

export function countErrors(input: {
  lines: CountLine[];
  countedOn: Date;
  today: Date;
}): string[] {
  const problems: string[] = [];
  const counted = countedLines(input.lines);

  if (counted.length === 0) {
    problems.push('Nothing has been counted yet. Put a number against at least one thing.');
  }

  if (counted.some((l) => (l.countedBase ?? 0) < 0)) {
    problems.push('A count cannot be negative. Zero is what an empty shelf is.');
  }

  /**
   * EVERY VARIANCE MUST SAY WHY.
   *
   * This is the one refusal in the whole file, and it is not a warn-never-block
   * violation: nothing a person SAW is being rejected. The count saves exactly
   * as typed. What is refused is writing a correction into the ledger with no
   * explanation attached — the same rule the flock ledger already applies to its
   * own adjustments, for the same reason. And "Nobody knows" is on the list, so
   * nobody is ever cornered into inventing a cause to get past this.
   */
  for (const line of discrepancies(input.lines)) {
    const variance = varianceOf(line)!;
    if (!line.cause) {
      problems.push(
        `${line.itemName} is out by ${say(line, Math.abs(variance))}. Say why before saving — ` +
          `"Nobody knows" is on the list and is a real answer.`,
      );
    } else if (!isValidCause(line.cause, variance)) {
      problems.push(
        `That reason does not explain ${line.itemName} being ${
          variance < 0 ? 'short' : 'over'
        }.`,
      );
    }
  }

  const days = dayGap(input.countedOn, input.today);
  if (days > 0) {
    problems.push('A count cannot happen in the future. Check the date.');
  } else if (days < -30) {
    // Further back than this and the ledger has moved so much since that the
    // variance measures the month rather than the count.
    problems.push(
      'That is more than a month ago. A count that old no longer describes what is on the shelf — count it again today.',
    );
  }

  return problems;
}

/**
 * What makes somebody look twice, without stopping them.
 *
 * THE SHELF IS THE SHELF. Refusing to record a surprising count does not change
 * what is in the store; it just means nobody knows. Every one of these saves
 * once the person confirms it — which is the whole warn-never-block rule, and it
 * matters more here than anywhere, because a big variance is exactly the entry a
 * system must not discourage.
 */
export function countWarnings(lines: CountLine[]): Warning[] {
  const warnings: Warning[] = [];

  for (const line of countedLines(lines)) {
    const variance = varianceOf(line)!;
    if (variance === 0) continue;

    const pct = variancePct(line);
    const direction = variance > 0 ? 'more' : 'fewer';
    const size = say(line, Math.abs(variance));

    if (line.expectedBase === 0 && variance > 0) {
      warnings.push({
        field: `count-${line.itemId}`,
        message: `The records had no ${line.itemName} at all, and you have counted ${size}. Check whether a delivery was never entered.`,
      });
      continue;
    }

    if (line.cause === 'suspected_theft') {
      warnings.push({
        field: `cause-${line.itemId}`,
        message: `You have recorded ${line.itemName} as suspected theft. That stays on the record against your name and today's date, and it cannot be edited or removed later. Only save it if that is what you mean.`,
      });
      continue;
    }

    if (pct !== null && Math.abs(pct) >= 10) {
      warnings.push({
        field: `count-${line.itemId}`,
        message: `${size} ${direction} ${line.itemName} than the records say — ${Math.abs(
          pct,
        )}% out. That is a large difference; count it again before saving if you can.`,
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// READING IT BACK
// ---------------------------------------------------------------------------

export function lineSentence(line: CountLine): string {
  const variance = varianceOf(line);
  if (variance === null) return `${line.itemName} — not counted.`;
  if (variance === 0) {
    return `${line.itemName} — ${say(line, line.countedBase!)} counted, and the records agreed.`;
  }
  const direction = variance > 0 ? 'more than' : 'fewer than';
  return `${line.itemName} — ${say(line, line.countedBase!)} counted, ${say(
    line,
    Math.abs(variance),
  )} ${direction} the records said.`;
}

/**
 * What the whole count found.
 *
 * SAYS "AGREED" RATHER THAN "NO ERRORS". A count that matches is not the system
 * being correct, it is the store and the records happening to agree on one day,
 * and the wording should not imply more than that.
 */
export function countSummary(lines: CountLine[]): string {
  const counted = countedLines(lines);
  if (counted.length === 0) return 'Nothing counted.';

  const off = discrepancies(lines);
  if (off.length === 0) {
    return `${counted.length} ${
      counted.length === 1 ? 'thing' : 'things'
    } counted, and the store agreed with the records on all of them.`;
  }

  const short = off.filter((l) => (varianceOf(l) ?? 0) < 0).length;
  const over = off.length - short;
  const parts: string[] = [];
  if (short > 0) parts.push(`${short} short`);
  if (over > 0) parts.push(`${over} over`);

  return `${counted.length} counted · ${parts.join(', ')}. The ledger has been corrected to match what was on the shelf.`;
}

/** Written onto every movement a count produces, so the ledger explains itself. */
export function adjustmentNote(reference: string, line: CountLine): string {
  const variance = varianceOf(line) ?? 0;
  const cause = causeLabel(line.cause ?? null);
  return (
    `Stock take ${reference}: counted ${say(line, line.countedBase!)}, ` +
    `records said ${say(line, line.expectedBase)} ` +
    `(${variance > 0 ? '+' : ''}${say(line, variance)}).` +
    (cause ? ` Reason given: ${cause}.` : '')
  );
}

/** `ST-2026-0007`. Written at the top of the sheet somebody counts onto. */
export function referenceFor(year: number, sequence: number): string {
  return `ST-${year}-${String(sequence).padStart(4, '0')}`;
}

export function sequenceOf(reference: string, year: number): number {
  const match = new RegExp(`^ST-${year}-(\\d{4,})$`).exec(reference);
  return match ? Number(match[1]) : 0;
}

/**
 * How long since this store was counted, in words.
 *
 * "NEVER" IS THE ANSWER MOST FARMS HAVE, and it should be said plainly rather
 * than shown as a blank.
 */
export function lastCountedSentence(lastCountedOn: Date | null, today: Date): string {
  if (!lastCountedOn) return 'This store has never been counted.';
  const days = Math.abs(dayGap(lastCountedOn, today));
  if (days === 0) return 'Counted today.';
  if (days === 1) return 'Counted yesterday.';
  if (days < 60) return `Counted ${days} days ago.`;
  return `Last counted ${lastCountedOn.toISOString().slice(0, 10)} — over two months ago.`;
}

function dayGap(a: Date, b: Date): number {
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((day(a) - day(b)) / 86_400_000);
}
