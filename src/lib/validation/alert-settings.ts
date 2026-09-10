import { z } from 'zod';
import { MAX_PARK_DAYS } from '@/lib/alerts';

/**
 * Alert threshold validation — ADRAH Farms
 *
 * THE BOUNDS HERE ARE SANITY CHECKS, NOT CLINICAL OPINION. They reject a stray
 * zero or a percent sign typed into a number box; they do not have a view on
 * what a normal death rate is. Anything a vet could plausibly mean is accepted,
 * including figures this software would consider surprising — the person filling
 * this in knows more about the birds than the schema does.
 */

const percentage = (label: string) =>
  z.coerce
    .number({ message: `${label} has to be a number.` })
    .min(0.001, `${label} of zero would alert on every single death.`)
    .max(100, `${label} cannot be more than the whole flock.`);

export const mortalityThresholdSchema = z
  .object({
    attentionPct: percentage('The attention figure'),
    criticalPct: percentage('The critical figure'),
  })
  .refine((v) => v.attentionPct <= v.criticalPct, {
    message:
      'The attention figure has to be at or below the critical one — otherwise nothing could ever reach critical without having passed attention first.',
    path: ['attentionPct'],
  });

export const stageThresholdSchema = z
  .object({
    stageId: z.string().trim().min(1),
    attentionPct: z.string().trim(),
    criticalPct: z.string().trim(),
  })
  .transform((v) => ({
    stageId: v.stageId,
    // BLANK MEANS "USE THE FARM FIGURE", not zero. A stage somebody clears
    // should inherit, and coercing an empty box to 0 would silently set the
    // loudest possible threshold on that stage instead.
    attentionPct: v.attentionPct === '' ? null : Number(v.attentionPct),
    criticalPct: v.criticalPct === '' ? null : Number(v.criticalPct),
  }))
  .refine(
    (v) =>
      (v.attentionPct === null || Number.isFinite(v.attentionPct)) &&
      (v.criticalPct === null || Number.isFinite(v.criticalPct)),
    { message: 'Those have to be numbers, or left blank to use the farm figure.' },
  )
  .refine((v) => (v.attentionPct ?? 0) >= 0 && (v.criticalPct ?? 0) >= 0, {
    message: 'A threshold cannot be negative.',
  })
  .refine(
    (v) =>
      v.attentionPct === null || v.criticalPct === null || v.attentionPct <= v.criticalPct,
    {
      message: 'The attention figure has to be at or below the critical one.',
      path: ['attentionPct'],
    },
  );

export const farmAlertSchema = z.object({
  mortalityAttentionPct: percentage('The attention figure'),
  mortalityCriticalPct: percentage('The critical figure'),
  mortalitySpikeMultiple: z.coerce
    .number({ message: 'The spike multiple has to be a number.' })
    .min(1.5, 'Below one and a half, ordinary variation counts as a spike and the rule fires most days.')
    .max(20, 'Above twenty this rule would effectively never fire.'),
  mortalitySpikeFloorDeaths: z.coerce
    .number({ message: 'The floor has to be a whole number of birds.' })
    .int('The floor has to be a whole number of birds.')
    .min(1, 'A floor of zero makes the spike rule fire on a single dead bird.')
    .max(100, 'A floor that high would hide a real outbreak on a small flock.'),
});

export const recordHourSchema = z.object({
  recordDueHour: z.coerce
    .number({ message: 'That has to be an hour of the day.' })
    .int('That has to be a whole hour.')
    .min(0, 'Hours run from 0 to 23.')
    .max(23, 'Hours run from 0 to 23.'),
});

/** Re-exported so the settings screen states the cap without importing twice. */
export { MAX_PARK_DAYS };
