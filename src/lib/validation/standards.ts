import { z } from 'zod';

/**
 * Breed standard validation — ADRAH Farms
 *
 * THE TABLE IS NOT VALIDATED HERE. It is pasted text, and the parsers in
 * `standards.ts` are the only thing that understands it — they report which rows
 * they skipped and why, which a Zod shape could not. This file checks that there
 * IS a table and that the fields around it are sane; the meaning is somebody
 * else's job, and duplicating any of it here would mean two places deciding what
 * a valid table is.
 */

export const standardTableSchema = z.object({
  breedId: z.string().trim().min(1, 'Which breed is this for?'),
  table: z
    .string()
    .min(1, 'Paste the two columns from the management guide.')
    // Generous: a full lay curve is ~70 rows and a weight table ~90, but a
    // person pasting a whole PDF page should be told, not silently truncated.
    .max(20000, 'That is more than a standards table. Paste just the two columns.'),
  /**
   * Set only when a guide prints both columns in one table and the lay curve is
   * wanted — detection reads the weight column first. Blank means "work it out".
   */
  kind: z
    .enum(['weight', 'lay'])
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Which edition of which guide, in the farm's own words. */
  sourceNote: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  /** The fingerprint of what the person actually read. See warnings.ts. */
  acknowledged: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
});

export const clearStandardSchema = z.object({
  breedId: z.string().trim().min(1),
  kind: z.enum(['weight', 'lay']),
});
