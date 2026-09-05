/**
 * Ghana reference data — ADRAH Farms
 *
 * The 16 administrative regions, following the 2019 reorganisation that split
 * the former Brong-Ahafo, Northern, Volta and Western regions.
 *
 * A free-text region field would produce "Ashanti", "ashanti", "Ashanti Region"
 * and "A/R" within a month, and every report grouped by region would be wrong.
 */

export const GHANA_REGIONS = [
  'Ahafo',
  'Ashanti',
  'Bono',
  'Bono East',
  'Central',
  'Eastern',
  'Greater Accra',
  'North East',
  'Northern',
  'Oti',
  'Savannah',
  'Upper East',
  'Upper West',
  'Volta',
  'Western',
  'Western North',
] as const;

export type GhanaRegion = (typeof GHANA_REGIONS)[number];

export function isGhanaRegion(value: string): value is GhanaRegion {
  return (GHANA_REGIONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// PHONE NUMBERS
// ---------------------------------------------------------------------------

/**
 * Ghanaian mobile numbers, as people actually write them.
 *
 * The same number reaches this system as "024 123 4567", "0241234567",
 * "+233241234567", "233 24 123 4567" and "24 123 4567". All five are correct,
 * and a farm is not the place to argue about formatting — so nothing here ever
 * REJECTS a number. What was typed is kept as typed; this only works out
 * whether a dialable form can be recovered from it, and produces one when it
 * can.
 *
 * Ghana is +233. A national number drops the leading 0 and keeps nine digits.
 */
export const GHANA_DIALLING_CODE = '233';

/**
 * The E.164 form, or null when the digits cannot make one.
 *
 * NULL IS A PERFECTLY GOOD ANSWER. A supplier reachable only through a landline
 * somebody wrote down wrongly is still a supplier, and the record keeps the
 * number as given — it simply cannot offer a WhatsApp link for it.
 */
export function toE164(input: string | null | undefined): string | null {
  if (!input) return null;

  const digits = input.replace(/\D/g, '');
  if (digits === '') return null;

  // Already international: 233 followed by nine national digits.
  if (digits.startsWith(GHANA_DIALLING_CODE) && digits.length === 12) {
    return `+${digits}`;
  }
  // National with the trunk zero: 0 followed by nine digits.
  if (digits.startsWith('0') && digits.length === 10) {
    return `+${GHANA_DIALLING_CODE}${digits.slice(1)}`;
  }
  // Bare national number, nine digits, no trunk zero.
  if (digits.length === 9) {
    return `+${GHANA_DIALLING_CODE}${digits}`;
  }

  return null;
}

/** "024 123 4567" — how a Ghanaian would read it back. Falls back to the input. */
export function formatGhanaPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const e164 = toE164(input);
  if (!e164) return input;

  const national = e164.slice(4); // drop "+233"
  return `0${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
}

/**
 * A wa.me link, or null.
 *
 * WhatsApp is how a Ghanaian farm actually reaches a feed supplier — a link
 * that opens the chat is worth more than a number somebody has to copy out.
 * wa.me wants the digits without the plus.
 */
export function whatsappLink(input: string | null | undefined): string | null {
  const e164 = toE164(input);
  return e164 ? `https://wa.me/${e164.slice(1)}` : null;
}

/** A tel: link for tapping to call. */
export function telLink(input: string | null | undefined): string | null {
  const e164 = toE164(input);
  return e164 ? `tel:${e164}` : null;
}
