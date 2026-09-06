'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import {
  createStaff,
  updateStaff,
  setStaffPin,
  setStaffPassword,
  setStaffActive,
  StaffError,
} from '@/lib/staff-service';
import {
  staffSchema,
  pinSchema,
  passwordSchema,
  parseRoles,
  parseSiteScope,
} from '@/lib/validation/staff';
import { fieldErrorsFrom } from '@/lib/validation/site';

export interface StaffFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: string;
  /** Set when a role change took a PIN away. Never merged into `ok`. */
  warning?: string;
}

export async function addStaff(
  _prev: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const principal = await requirePermission('user:create');

  const parsed = staffSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let id: string;
  try {
    const result = await createStaff(
      principal,
      parsed.data,
      parseRoles(formData),
      parseSiteScope(formData),
    );
    id = result.id;
  } catch (error) {
    if (error instanceof StaffError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'user.create',
    entityType: 'User',
    entityId: id,
    after: { name: parsed.data.name, roles: parseRoles(formData) },
  });

  revalidatePath('/staff');
  redirect(`/staff/${id}`);
}

export async function editStaff(
  userId: string,
  _prev: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const principal = await requirePermission('user:edit');

  const parsed = staffSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const roles = parseRoles(formData);
  let warning: string | undefined;
  try {
    const result = await updateStaff(
      principal,
      userId,
      parsed.data,
      roles,
      parseSiteScope(formData),
    );
    if (result.pinConsequence.kind === 'revoked') warning = result.pinConsequence.message;
  } catch (error) {
    if (error instanceof StaffError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'permission.change',
    entityType: 'User',
    entityId: userId,
    after: { name: parsed.data.name, roles, pinRevoked: warning !== undefined },
  });

  revalidatePath('/staff');
  revalidatePath(`/staff/${userId}`);
  return { ok: 'Saved.', warning };
}

/**
 * Set a PIN.
 *
 * The confirmation field is compared HERE rather than in the schema, so the
 * message can name the field the person should look at. Nothing about the PIN
 * is stored except its hash, and nothing is returned to the caller — whoever set
 * it already knows what they typed.
 */
export async function setPin(
  userId: string,
  _prev: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const principal = await requirePermission('user:edit');

  const parsed = pinSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  if (parsed.data.pin !== parsed.data.confirmPin) {
    return { fieldErrors: { confirmPin: 'The two do not match.' } };
  }

  try {
    await setStaffPin(principal, userId, parsed.data.pin);
  } catch (error) {
    if (error instanceof StaffError) return { error: error.message };
    throw error;
  }

  // The PIN itself is NEVER written to the audit log — see redact() in audit.ts,
  // which strips it, and this call, which does not offer it.
  await recordAudit({
    principal,
    action: 'user.update',
    entityType: 'User',
    entityId: userId,
    after: { pinSet: true },
  });

  revalidatePath(`/staff/${userId}`);
  return {
    ok:
      'PIN set. Tell them now, in person — it is stored only as a fingerprint and nobody, ' +
      'including you, can read it back.',
  };
}

export async function setPassword(
  userId: string,
  _prev: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const principal = await requirePermission('user:edit');

  const parsed = passwordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  try {
    await setStaffPassword(principal, userId, parsed.data.password);
  } catch (error) {
    if (error instanceof StaffError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'user.update',
    entityType: 'User',
    entityId: userId,
    after: { passwordSet: true, mustChangePassword: true },
  });

  revalidatePath(`/staff/${userId}`);
  return {
    ok: 'Password set. They will be asked to change it the first time they sign in.',
  };
}

/**
 * Deactivate or restore.
 *
 * The intent is stated rather than inferred from current state, so a double tap
 * on a slow connection cannot deactivate and immediately restore.
 */
export async function toggleStaff(
  userId: string,
  _prev: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  // user:edit, not a separate permission — the ACTIONS catalogue has no
  // "deactivate". Anyone who can change somebody's roles can already take every
  // one of them away, so a distinct permission here would be a door beside an
  // open one.
  const principal = await requirePermission('user:edit');

  const intent = String(formData.get('intent') ?? '');
  if (intent !== 'deactivate' && intent !== 'restore') {
    return { error: 'That action is not recognised.' };
  }

  let name: string;
  try {
    name = await setStaffActive(principal, userId, intent === 'restore');
  } catch (error) {
    if (error instanceof StaffError) return { error: error.message };
    throw error;
  }

  await recordAudit({
    principal,
    action: 'user.deactivate',
    entityType: 'User',
    entityId: userId,
    after: { isActive: intent === 'restore' },
  });

  revalidatePath('/staff');
  revalidatePath(`/staff/${userId}`);
  return {
    ok:
      intent === 'deactivate'
        ? `${name} can no longer sign in. Everything they recorded stays exactly as it is.`
        : `${name} can sign in again.`,
  };
}
