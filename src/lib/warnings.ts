import { createHash } from 'node:crypto';

/**
 * Warnings and their acknowledgement — ADRAH Farms
 *
 * THE RULE ACROSS THE WHOLE SYSTEM: WARN, NEVER BLOCK.
 *
 * A farm system that refuses an unusual number teaches people to stop recording
 * unusual numbers, and unusual numbers are the entire reason the system exists.
 * So a check produces a message, the person sees it, confirms, and the entry
 * saves exactly as they typed it.
 */

export interface Warning {
  field: string;
  message: string;
}

/**
 * A fingerprint of exactly which warnings were shown.
 *
 * WHY A TOKEN AND NOT A BOOLEAN.
 *   A plain "I have seen the warnings" checkbox stays ticked. Correct the
 *   mortality figure, mistype the feed instead, and the form submits with the
 *   old acknowledgement still attached — saving a brand-new problem that was
 *   never displayed to anyone. This was a real bug, found in the daily record.
 *
 *   Tying the acknowledgement to the CONTENT means it only covers the warnings
 *   the person actually read. Change the entry, and any new warning has to be
 *   shown and accepted on its own terms.
 *
 * Shared rather than copied: a second implementation of this would drift, and a
 * drifted fingerprint fails open — it silently accepts warnings nobody saw.
 */
export function warningToken(warnings: Warning[]): string {
  const canonical = warnings
    .map((w) => `${w.field}:${w.message}`)
    .sort()
    .join('|');
  return createHash('sha1').update(canonical).digest('hex').slice(0, 16);
}
