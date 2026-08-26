import { z } from 'zod';

/**
 * Weight sample validation — ADRAH Farms
 *
 * Weighing birds means standing in a house with a scale in one hand and a phone
 * in the other, calling out numbers. So the input is one free field where the
 * weights are typed in a row, separated by whatever the person naturally types —
 * spaces, commas, newlines. Fighting the separator is not a job for the farmer.
 */

/** Sane bounds for a bird on a scale, in grams: a day-old chick to a large hen. */
const MIN_GRAMS = 10;
const MAX_GRAMS = 8000;

export interface ParsedWeights {
  weights: number[];
  /** Entries that could not be read as a weight, kept so the message can name them. */
  rejected: string[];
}

/**
 * Read a typed list of weights.
 *
 * Accepts "1400, 1410 1395" and newline-separated columns equally. Decimals are
 * rounded — scales read to the gram and a tenth of a gram on a live bird is
 * noise, not precision.
 */
export function parseWeights(input: string): ParsedWeights {
  const tokens = input
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const weights: number[] = [];
  const rejected: string[] = [];

  for (const token of tokens) {
    const value = Number(token);
    if (!Number.isFinite(value) || value < MIN_GRAMS || value > MAX_GRAMS) {
      rejected.push(token);
      continue;
    }
    weights.push(Math.round(value));
  }

  return { weights, rejected };
}

const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'That date is not valid.')
  .refine((d) => {
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return d.getTime() <= today;
  }, 'That date is in the future.');

export const weightSampleSchema = z
  .object({
    takenOn: dateOnly,
    /** The typed list. Empty when an average is being entered instead. */
    weights: z.string().trim().optional().default(''),
    /**
     * For data tallied on paper, where only the average survived.
     *
     * Accepted, but it cannot produce a uniformity figure — that needs the
     * spread, not the middle. The UI says so rather than showing a blank and
     * letting someone assume the flock is even.
     */
    averageGrams: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v === undefined || v === '' ? null : Number(v))),
    sampleSize: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v === undefined || v === '' ? null : Number(v))),
    notes: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
  })
  .superRefine((data, ctx) => {
    const { weights } = parseWeights(data.weights);

    if (weights.length === 0 && data.averageGrams === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['weights'],
        message: 'Enter the individual weights, or an average and how many birds.',
      });
      return;
    }

    if (weights.length === 0) {
      if (
        data.averageGrams === null ||
        !Number.isFinite(data.averageGrams) ||
        data.averageGrams < MIN_GRAMS ||
        data.averageGrams > MAX_GRAMS
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['averageGrams'],
          message: `An average weight between ${MIN_GRAMS} g and ${MAX_GRAMS} g.`,
        });
      }
      if (data.sampleSize === null || !Number.isInteger(data.sampleSize) || data.sampleSize < 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['sampleSize'],
          message: 'How many birds were weighed?',
        });
      }
      return;
    }

    if (weights.length === 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['weights'],
        message:
          'One bird is not a sample. Weigh at least 2 — uniformity needs the spread, and 50 or more is the usual advice.',
      });
    }
  });

export type WeightSampleInput = z.infer<typeof weightSampleSchema>;
