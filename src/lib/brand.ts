/**
 * Brand configuration — ADRAH Farms
 *
 * The company name appears in the UI, emails, invoices, PDF headers and the
 * WhatsApp message template. It is defined ONCE, here. Nothing else in the
 * codebase contains the string "ADRAH".
 *
 * Colours live in src/app/globals.css as design tokens — this file holds the
 * facts about the business, not its styling.
 */

export const BRAND = {
  name: 'ADRAH Farms',
  /** Legal suffix still to be confirmed (Ltd / Enterprise) — see spec assumption A1. */
  legalName: 'ADRAH Farms',
  tagline: 'Fresh eggs, daily',
  descriptor: 'Fresh eggs · Ghana',

  contact: {
    /** E.164. Placeholders until the business lines are confirmed. */
    salesPhone: '+233000000000',
    whatsappPhone: '+233000000000',
    email: 'hello@adrahfarms.com',
  },

  location: {
    /** Spec assumptions A2 — to be confirmed. */
    town: '',
    district: '',
    region: '',
    country: 'Ghana',
  },

  locale: 'en-GH',
  currency: 'GHS',
  timezone: 'Africa/Accra',
} as const;

/**
 * Build the pre-filled WhatsApp ordering deep link.
 *
 * Uses wa.me — no API key, no approval process, no cost, and it works today on
 * every phone that matters. The WhatsApp Business API is a later decision, taken
 * on volume rather than on novelty.
 */
export function whatsappOrderLink(input: {
  productName?: string;
  productCode?: string;
  quantity?: string;
}): string {
  const lines = [
    `Hello, I would like to order from ${BRAND.name}.`,
    '',
    input.productName ? `Product: ${input.productName}` : 'Product:',
    input.productCode ? `Product code: ${input.productCode}` : null,
    input.quantity ? `Quantity: ${input.quantity}` : 'Quantity:',
    'Delivery / Pickup:',
  ].filter((l): l is string => l !== null);

  const number = BRAND.contact.whatsappPhone.replace(/\D/g, '');
  return `https://wa.me/${number}?text=${encodeURIComponent(lines.join('\n'))}`;
}

/** `tel:` link for the CALL NOW button. */
export function telLink(phone: string = BRAND.contact.salesPhone): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/**
 * Format a Ghanaian number for display: +233 24 123 4567.
 * Accepts 0241234567, 233241234567 or +233241234567.
 */
export function formatGhanaPhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  let national = digits;
  if (digits.startsWith('233')) national = digits.slice(3);
  else if (digits.startsWith('0')) national = digits.slice(1);
  if (national.length !== 9) return input;
  return `+233 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
}

/** Normalise any Ghanaian input to E.164 for storage. Returns null if not valid. */
export function toE164Ghana(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  let national = digits;
  if (digits.startsWith('233')) national = digits.slice(3);
  else if (digits.startsWith('0')) national = digits.slice(1);
  if (national.length !== 9) return null;
  return `+233${national}`;
}
