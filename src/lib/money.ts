/**
 * Money — ADRAH Farms
 *
 * RULE: money is an INTEGER NUMBER OF PESEWAS. Never a float, never a string,
 * never a Decimal that someone might `Number()` on the way to the UI.
 *
 * 1 Ghana Cedi (GHS) = 100 pesewas.
 *
 * Floating point cannot represent 0.1 exactly, so `0.1 + 0.2 !== 0.3`. In a farm
 * that sells sixty crates a day, those errors accumulate into a reconciliation
 * meeting nobody enjoys. Integers make the arithmetic exact by construction.
 */

/** An integer count of pesewas. Branded so a bare number cannot be passed by mistake. */
export type Pesewas = number & { readonly __brand: 'Pesewas' };

export const CURRENCY = 'GHS' as const;
const PESEWAS_PER_CEDI = 100;

class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Assert a raw number is a usable pesewa amount and brand it. */
export function pesewas(value: number): Pesewas {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`Amount must be finite, received ${value}`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(
      `Amount must be a whole number of pesewas, received ${value}. ` +
        `Use fromCedis() to convert, or round explicitly.`,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Amount exceeds safe integer range: ${value}`);
  }
  return value as Pesewas;
}

export const ZERO = pesewas(0);

/**
 * Convert cedis (as typed by a human, e.g. 12.50) into pesewas.
 * Rounds half away from zero, so 0.005 becomes 1 pesewa rather than 0.
 */
export function fromCedis(cedis: number): Pesewas {
  if (!Number.isFinite(cedis)) {
    throw new MoneyError(`Cedi amount must be finite, received ${cedis}`);
  }
  return pesewas(roundHalfAwayFromZero(cedis * PESEWAS_PER_CEDI));
}

/** Convert pesewas back to a cedi number. For DISPLAY and export only — never for arithmetic. */
export function toCedis(amount: Pesewas): number {
  return amount / PESEWAS_PER_CEDI;
}

/**
 * Parse user input such as "12.50", "GHS 12.50", "1,250" or "12".
 * Returns null on anything unparseable so callers can show a field error
 * rather than silently recording zero.
 */
export function parseCedis(input: string): Pesewas | null {
  const cleaned = input.replace(/[^\d.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return fromCedis(parsed);
}

export function add(...amounts: Pesewas[]): Pesewas {
  return pesewas(amounts.reduce<number>((sum, a) => sum + a, 0));
}

export function subtract(a: Pesewas, b: Pesewas): Pesewas {
  return pesewas(a - b);
}

/**
 * Multiply an amount by a quantity or rate (e.g. 4.5 bags x unit cost).
 * Rounds half away from zero to the nearest pesewa.
 */
export function multiply(amount: Pesewas, factor: number): Pesewas {
  if (!Number.isFinite(factor)) {
    throw new MoneyError(`Factor must be finite, received ${factor}`);
  }
  return pesewas(roundHalfAwayFromZero(amount * factor));
}

/** Divide an amount, e.g. total cost / bird count. Returns null when divisor is 0. */
export function divide(amount: Pesewas, divisor: number): Pesewas | null {
  if (!Number.isFinite(divisor) || divisor === 0) return null;
  return pesewas(roundHalfAwayFromZero(amount / divisor));
}

/**
 * Split an amount into N parts without losing or inventing pesewas.
 * `allocate(1000, 3)` returns [334, 333, 333] — the remainder is distributed
 * from the front, and the parts always sum exactly to the original.
 *
 * Used for apportioning a shared cost (a feed delivery, a vet visit) across
 * several flocks. Naive division would quietly lose money on every split.
 */
export function allocate(amount: Pesewas, parts: number): Pesewas[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new MoneyError(`Parts must be a positive integer, received ${parts}`);
  }
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  const base = Math.floor(abs / parts);
  let remainder = abs - base * parts;

  return Array.from({ length: parts }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return pesewas(sign * (base + extra));
  });
}

/**
 * Apportion an amount across weights (e.g. feed cost across flocks by bird-days).
 * Guarantees the parts sum exactly to the original amount.
 */
export function allocateByWeights(amount: Pesewas, weights: number[]): Pesewas[] {
  if (weights.length === 0) throw new MoneyError('At least one weight is required');
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) {
    throw new MoneyError('Weights must be finite and non-negative');
  }
  const total = weights.reduce((s, w) => s + w, 0);
  if (total === 0) return allocate(amount, weights.length);

  const raw = weights.map((w) => (amount * w) / total);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = amount - floored.reduce((s, f) => s + f, 0);

  // Give the leftover pesewas to the parts with the largest fractional loss.
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);

  const result = [...floored];
  for (const { i } of order) {
    if (remainder <= 0) break;
    result[i] += 1;
    remainder -= 1;
  }
  return result.map(pesewas);
}

/**
 * Format for display, e.g. "GHS 1,250.00".
 * `compact` gives "GHS 1.3k" for dashboard tiles where space is tight.
 */
export function formatGHS(
  amount: Pesewas,
  options: { compact?: boolean; showSymbol?: boolean } = {},
): string {
  const { compact = false, showSymbol = true } = options;
  const value = toCedis(amount);
  const formatted = new Intl.NumberFormat('en-GH', {
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 1 : 2,
    notation: compact ? 'compact' : 'standard',
  }).format(value);
  return showSymbol ? `${CURRENCY} ${formatted}` : formatted;
}

/**
 * JavaScript's Math.round rounds -0.5 to -0 ("half up"), which makes negative
 * amounts round differently from positive ones. Accounting expects symmetry.
 */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}
