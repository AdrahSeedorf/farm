import type { Warning } from '@/lib/warnings';
import { daysBetween } from '@/lib/health-schedule';

/**
 * Plausibility checks for a health event — ADRAH Farms
 *
 * WARN, NEVER BLOCK, exactly as everywhere else. A vaccination that really did
 * happen must be recordable whatever the store's figures say: the alternative is
 * a farm that gave a vaccine and has no record of it, which is worse for the
 * birds and worse for anyone reading the history later.
 *
 * NOTHING HERE IS CLINICAL. These look for signs the ENTRY is wrong — a count
 * larger than the flock, a date long in the past, a medication recorded with no
 * withdrawal period — not for whether the treatment was a good idea.
 */

export function checkHealthEvent(input: {
  birdsTreated: number | null;
  population: number;
  occurredOn: Date;
  today: Date;
  ageDays: number;
  eventType: string;
  eggWithdrawalDays: number | null;
  meatWithdrawalDays: number | null;
  /** Set when the entry draws on stock. */
  requiredBase: number | null;
  availableBase: number | null;
  itemName: string | null;
  storeName: string | null;
}): Warning[] {
  const warnings: Warning[] = [];

  if (
    input.birdsTreated !== null &&
    input.population > 0 &&
    input.birdsTreated > input.population
  ) {
    warnings.push({
      field: 'birdsTreated',
      message:
        `${input.birdsTreated} birds treated, but the flock holds ${input.population}. ` +
        `Check the figure, or whether this belongs to a different house.`,
    });
  }

  const daysAgo = daysBetween(input.occurredOn, input.today);
  if (daysAgo > 30) {
    warnings.push({
      field: 'occurredOn',
      message:
        `This is dated ${daysAgo} days ago. Recording it is right — just check the date, ` +
        `because it changes what the schedule says was done on time.`,
    });
  }

  const isMedicine = input.eventType === 'MEDICATION' || input.eventType === 'TREATMENT';
  if (isMedicine && input.eggWithdrawalDays === null && input.meatWithdrawalDays === null) {
    warnings.push({
      field: 'eggWithdrawalDays',
      message:
        'No withdrawal period recorded for a medication. Blank means nobody wrote one ' +
        'down, not that none applies — and without it nothing will hold back sales.',
    });
  }

  if (
    input.requiredBase !== null &&
    input.availableBase !== null &&
    input.itemName &&
    input.storeName
  ) {
    const short = round(input.requiredBase - input.availableBase);
    if (short > 0) {
      warnings.push({
        field: 'quantityBase',
        message:
          `The store shows only ${round(input.availableBase)} of ${input.itemName} in ` +
          `${input.storeName}, but this needs ${round(input.requiredBase)}. ` +
          `The event will be recorded in full and the store taken to zero — ` +
          `a delivery has probably not been entered.`,
      });
    }
  }

  return warnings;
}

/**
 * What a treatment restricts, said in words, at the moment it is recorded.
 *
 * Shown BEFORE saving as well as after. Someone giving an antibiotic to a laying
 * flock needs to know at that moment that the eggs cannot be sold for a week —
 * finding out afterwards means the eggs have already gone out.
 */
export function withdrawalWarning(
  occurredOn: Date,
  eggWithdrawalDays: number | null,
  meatWithdrawalDays: number | null,
): string | null {
  const parts: string[] = [];
  const on = (days: number) =>
    new Date(
      Date.UTC(occurredOn.getUTCFullYear(), occurredOn.getUTCMonth(), occurredOn.getUTCDate()) +
        days * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);

  if (eggWithdrawalDays !== null && eggWithdrawalDays > 0) {
    parts.push(`eggs cannot be sold until ${on(eggWithdrawalDays)}`);
  }
  if (meatWithdrawalDays !== null && meatWithdrawalDays > 0) {
    parts.push(`birds cannot be sold for meat until ${on(meatWithdrawalDays)}`);
  }

  return parts.length === 0 ? null : `After this, ${parts.join(', and ')}.`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
