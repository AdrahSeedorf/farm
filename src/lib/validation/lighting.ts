import { z } from 'zod';
import { SUPPLEMENT_MODES } from '@/lib/lighting';

/**
 * Lighting validation — ADRAH Farms
 *
 * HOURS ARRIVE AS A DECIMAL AND LUX AS A WHOLE NUMBER, and both are blank-able
 * in different ways. A blank lux means nobody has measured, which is a real
 * answer and must survive as null; a blank hours figure is simply a missing
 * answer and is refused. Collapsing the two into one "optional number" helper is
 * how the meaning of a blank gets lost.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v));

export const stepSchema = z.object({
  programmeId: z.string().trim().min(1),
  ageDays: z
    .string()
    .trim()
    .min(1, 'From what age?')
    .superRefine((v, ctx) => {
      if (!/^\d+$/.test(v)) {
        ctx.addIssue({ code: 'custom', message: 'Age is a whole number of days.' });
      }
    })
    .transform(Number),
  totalHours: z
    .string()
    .trim()
    .min(1, 'How many hours of light?')
    .superRefine((v, ctx) => {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: 'custom', message: 'Write it like 13 or 13.5.' });
      }
    })
    .transform(Number),
  /**
   * BLANK STAYS NULL. "Nobody has measured the light level" is a different and
   * more honest statement than "the light level is zero", and the programme
   * screens say so out loud.
   */
  lux: z
    .string()
    .trim()
    .optional()
    .superRefine((v, ctx) => {
      if (v === '' || v === undefined) return;
      if (!/^\d+$/.test(v)) {
        ctx.addIssue({ code: 'custom', message: 'Lux is a whole number, or leave it blank.' });
      }
    })
    .transform((v) => (v === '' || v === undefined ? null : Number(v))),
  note: optionalText(300),
  acknowledged: optionalText(64),
});

export const modeSchema = z.object({
  programmeId: z.string().trim().min(1),
  mode: z.enum(SUPPLEMENT_MODES, { message: 'Choose where the extra hours go.' }),
});
