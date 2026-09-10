'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { park, lift, AlertAckError } from '@/lib/alert-ack-service';
import { parkSchema, liftSchema } from '@/lib/validation/alert';
import { fieldErrorsFrom } from '@/lib/validation/site';

export interface AlertFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: string;
}

/**
 * Park an alert.
 *
 * THERE IS NO `requirePermission` CALL HERE, and that is not an omission.
 *
 * Which permission is needed depends on WHICH ALERT is being parked — parking a
 * late order needs `procurement:edit`, parking an unread incident needs
 * `incident:edit` — and that cannot be known until the key has been parsed and
 * checked against the catalogue. So the check lives in `park()`, one layer
 * further in, where the rule is known and where it cannot be reached around: no
 * other code path writes an acknowledgement.
 */
export async function parkAlert(
  _prev: AlertFormState,
  formData: FormData,
): Promise<AlertFormState> {
  const principal = await requirePrincipal();

  const parsed = parkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let result: { rule: string };
  try {
    result = await park(principal, parsed.data);
  } catch (error) {
    if (error instanceof AlertAckError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'alert.park',
    entityType: 'AlertAcknowledgement',
    entityId: parsed.data.alertKey,
    after: {
      rule: result.rule,
      note: parsed.data.note,
      until: parsed.data.until.toISOString().slice(0, 10),
    },
  });

  // No `ok` message. The outcome is the alert moving into the Parked section on
  // the same page — see the note in AlertForms.tsx about why a message here
  // could never reach the screen.
  revalidatePath('/alerts');
  return {};
}

export async function liftAlert(
  _prev: AlertFormState,
  formData: FormData,
): Promise<AlertFormState> {
  const principal = await requirePrincipal();

  const parsed = liftSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'That is no longer parked.' };

  let result: { alertKey: string };
  try {
    result = await lift(principal, parsed.data.parkId);
  } catch (error) {
    if (error instanceof AlertAckError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'alert.lift',
    entityType: 'AlertAcknowledgement',
    entityId: result.alertKey,
    after: { parkId: parsed.data.parkId },
  });

  revalidatePath('/alerts');
  return {};
}
