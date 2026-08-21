import type { AnimalGroupEventType } from '@/lib/ledger';

/**
 * Reason codes — ADRAH Farms
 *
 * A controlled vocabulary, not a free-text box.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS
 *   "heat", "Heat", "hot weather", "too hot", "heat stress?" are five different
 *   values describing one cause. A year later, "what killed the most birds" is
 *   unanswerable — not because the data was missing, but because it was typed.
 *
 *   Free text still has a place: every event carries an optional `notes` field
 *   for the detail a code cannot hold. The code is for counting; the note is for
 *   remembering.
 *
 * These are DATA, deliberately editable in one place. They describe poultry
 * because poultry is what the farm runs today; adding pigs later means adding
 * codes here, not changing how events work.
 */

export interface ReasonCode {
  key: string;
  label: string;
  /** Which event types this code may be used with. */
  appliesTo: AnimalGroupEventType[];
  /** Shown as help text where the distinction is easy to get wrong. */
  hint?: string;
}

export const REASON_CODES: readonly ReasonCode[] = [
  // --- Mortality ---
  { key: 'disease', label: 'Disease / suspected disease', appliesTo: ['MORTALITY'] },
  {
    key: 'heat_stress',
    label: 'Heat stress',
    appliesTo: ['MORTALITY'],
    hint: 'Deaths clustered in the hottest part of the day.',
  },
  { key: 'chilling', label: 'Chilling / brooder failure', appliesTo: ['MORTALITY'] },
  {
    key: 'piling',
    label: 'Piling / suffocation',
    appliesTo: ['MORTALITY'],
    hint: 'Birds crowding into a corner, common after a fright or a cold patch.',
  },
  { key: 'predation', label: 'Predation', appliesTo: ['MORTALITY'] },
  { key: 'injury', label: 'Injury / accident', appliesTo: ['MORTALITY'] },
  { key: 'cannibalism', label: 'Pecking / cannibalism', appliesTo: ['MORTALITY'] },
  { key: 'starve_out', label: 'Starve-out / failure to thrive', appliesTo: ['MORTALITY'] },
  { key: 'doa', label: 'Dead on arrival', appliesTo: ['MORTALITY'] },
  {
    key: 'unknown',
    label: 'Unknown',
    appliesTo: ['MORTALITY'],
    hint: 'Honest and useful. Guessing a cause is worse than recording that you did not know.',
  },

  // --- Culling: a decision, not an event that happened to you ---
  { key: 'sick', label: 'Sick / not recovering', appliesTo: ['CULL'] },
  { key: 'injured', label: 'Injured beyond treatment', appliesTo: ['CULL'] },
  { key: 'poor_condition', label: 'Poor condition / runt', appliesTo: ['CULL'] },
  { key: 'non_productive', label: 'Not laying', appliesTo: ['CULL'] },
  { key: 'deformity', label: 'Deformity', appliesTo: ['CULL'] },

  // --- Movement ---
  { key: 'house_transfer', label: 'Moved to another house', appliesTo: ['TRANSFER_OUT', 'TRANSFER_IN'] },
  { key: 'quarantine', label: 'Moved to quarantine', appliesTo: ['TRANSFER_OUT', 'TRANSFER_IN'] },
  { key: 'point_of_lay', label: 'Transferred at point of lay', appliesTo: ['TRANSFER_OUT', 'TRANSFER_IN'] },

  // --- Sale ---
  { key: 'sale_live', label: 'Sold live', appliesTo: ['SALE'] },
  { key: 'sale_spent', label: 'Sold as spent layers', appliesTo: ['SALE'] },
  { key: 'own_use', label: 'Taken for own use', appliesTo: ['SALE'] },

  // --- Correction ---
  {
    key: 'recount',
    label: 'Physical recount',
    appliesTo: ['ADJUSTMENT'],
    hint: 'The count on the ground disagreed with the system. This records the difference — it never rewrites history.',
  },
  {
    key: 'entry_error',
    label: 'Correcting an earlier entry',
    appliesTo: ['ADJUSTMENT'],
    hint: 'The original entry stays in the timeline. This is a new event that offsets it.',
  },
  { key: 'miscount_on_arrival', label: 'Supplier delivered a different number', appliesTo: ['ADJUSTMENT'] },
] as const;

export function reasonCodesFor(type: AnimalGroupEventType): ReasonCode[] {
  return REASON_CODES.filter((code) => code.appliesTo.includes(type));
}

export function reasonLabel(key: string | null | undefined): string {
  if (!key) return '—';
  return REASON_CODES.find((c) => c.key === key)?.label ?? key;
}

export function isValidReason(key: string, type: AnimalGroupEventType): boolean {
  return reasonCodesFor(type).some((c) => c.key === key);
}

/** Human labels for the event types themselves. */
export const EVENT_LABELS: Record<AnimalGroupEventType, string> = {
  PLACEMENT: 'Birds placed',
  MORTALITY: 'Mortality',
  CULL: 'Culled',
  SALE: 'Sold',
  TRANSFER_IN: 'Transferred in',
  TRANSFER_OUT: 'Transferred out',
  ADJUSTMENT: 'Adjustment',
  STAGE_CHANGE: 'Stage change',
};
