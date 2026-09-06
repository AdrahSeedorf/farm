'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { clockIn, clockOut, AttendanceError } from '@/lib/attendance-service';
import { fieldErrorsFrom } from '@/lib/validation/site';

export interface ClockFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: string;
}

/**
 * Clocking yourself in or out.
 *
 * THE TIME IS THE SERVER'S, not the form's. A clock-in that accepted a time from
 * the browser would accept any time at all, and "I was here at six" is precisely
 * the claim this record exists to settle. Somebody who genuinely arrived earlier
 * asks a supervisor to correct it, which leaves a reason attached.
 */
const selfSchema = z.object({
  siteId: z.string().trim().min(1, 'Choose which farm you are at.'),
  intent: z.enum(['in', 'out']),
});

export async function punch(
  _prev: ClockFormState,
  formData: FormData,
): Promise<ClockFormState> {
  const principal = await requirePermission('attendance:create');

  const parsed = selfSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  try {
    if (parsed.data.intent === 'in') {
      await clockIn(principal, { siteId: parsed.data.siteId });
    } else {
      await clockOut(principal, { siteId: parsed.data.siteId });
    }
  } catch (error) {
    if (error instanceof AttendanceError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: parsed.data.intent === 'in' ? 'attendance.clockIn' : 'attendance.clockOut',
    entityType: 'AttendanceEvent',
    entityId: principal.userId,
    after: { siteId: parsed.data.siteId, onBehalf: false },
  });

  revalidatePath('/attendance');
  return {
    ok:
      parsed.data.intent === 'in'
        ? 'Clocked in. Remember to clock out when you finish.'
        : 'Clocked out. Thank you.',
  };
}

/**
 * Recording somebody else's clock-in or clock-out.
 *
 * THIS IS WHERE THE FORGOTTEN CLOCK-OUT GETS FIXED, and it is deliberately a
 * different action with a different permission and a required reason. The
 * alternative — letting the system close open shifts at a sensible hour
 * overnight — produces a tidy record that is quietly made up.
 */
const correctionSchema = z.object({
  userId: z.string().trim().min(1, 'Choose whose shift this is.'),
  siteId: z.string().trim().min(1, 'Choose which farm.'),
  intent: z.enum(['in', 'out']),
  occurredAt: z
    .string()
    .trim()
    .min(1, 'Enter the time it actually happened.')
    .transform((v) => new Date(`${v}:00.000Z`))
    .refine((d) => !Number.isNaN(d.getTime()), 'That is not a valid time.'),
  correctionReason: z
    .string()
    .trim()
    .min(3, 'Say why you are recording this for them.')
    .max(200),
});

export async function correct(
  _prev: ClockFormState,
  formData: FormData,
): Promise<ClockFormState> {
  // attendance:edit, not attendance:create — recording on somebody's behalf is
  // a supervisory act, and a worker holds create but not edit.
  const principal = await requirePermission('attendance:edit');

  const parsed = correctionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const { userId, siteId, intent, occurredAt, correctionReason } = parsed.data;

  let userName: string;
  try {
    const result =
      intent === 'in'
        ? await clockIn(principal, { userId, siteId, occurredAt, correctionReason })
        : await clockOut(principal, { userId, siteId, occurredAt, correctionReason });
    userName = result.userName;
  } catch (error) {
    if (error instanceof AttendanceError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'attendance.correct',
    entityType: 'AttendanceEvent',
    entityId: userId,
    after: {
      intent,
      occurredAt: occurredAt.toISOString(),
      reason: correctionReason,
      onBehalf: true,
    },
  });

  revalidatePath('/attendance');
  return {
    ok: `Recorded for ${userName}, with your name and reason attached to it.`,
  };
}
