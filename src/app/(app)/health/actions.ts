'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { canAccessSite, orgFilter } from '@/lib/scope';
import { parseProgrammeTable, type ParsedProgrammeItem } from '@/lib/health-programme';
import { importProgrammeItems, touchProgramme } from '@/lib/health-service';
import { recordHealthEvent } from '@/lib/health-event-service';
import {
  programmeSchema,
  programmeItemSchema,
  approvalSchema,
  programmeImportSchema,
  healthEventSchema,
} from '@/lib/validation/health';
import { fieldErrorsFrom } from '@/lib/validation/site';
import { AuthorizationError } from '@/lib/rbac';
import type { Warning } from '@/lib/warnings';

export interface HealthFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: string;
  /** Read from a pasted table, shown before anything is written. */
  preview?: { rows: ParsedProgrammeItem[]; warnings: Warning[] };
  /** Shown for confirmation. Nothing is written while these stand. */
  warnings?: Warning[];
  warningToken?: string;
}

export async function createProgramme(
  _prev: HealthFormState,
  formData: FormData,
): Promise<HealthFormState> {
  const principal = await requirePermission('health:create');

  const parsed = programmeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const existing = await db.healthProgramme.findFirst({
    where: { ...orgFilter(principal), name: parsed.data.name },
  });
  if (existing) return { fieldErrors: { name: 'A programme with that name already exists.' } };

  const programme = await db.healthProgramme.create({
    data: { ...parsed.data, organisationId: principal.organisationId },
  });

  await recordAudit({
    principal,
    action: 'healthProgramme.create',
    entityType: 'HealthProgramme',
    entityId: programme.id,
    after: { name: programme.name, source: programme.sourceName },
  });

  revalidatePath('/health');
  redirect(`/health/${programme.id}`);
}

export async function updateProgramme(
  programmeId: string,
  _prev: HealthFormState,
  formData: FormData,
): Promise<HealthFormState> {
  const principal = await requirePermission('health:edit');

  const parsed = programmeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const before = await db.healthProgramme.findFirst({
    where: { id: programmeId, ...orgFilter(principal) },
  });
  if (!before) return { error: 'That programme no longer exists.' };

  const after = await db.healthProgramme.update({
    where: { id: programmeId },
    data: parsed.data,
  });

  // A name or a description changes no instruction anyone acts on, so the
  // approval stands.
  await touchProgramme(programmeId, { contentChanged: false });

  await recordAudit({
    principal,
    action: 'healthProgramme.update',
    entityType: 'HealthProgramme',
    entityId: programmeId,
    before,
    after,
  });

  revalidatePath(`/health/${programmeId}`);
  return { ok: 'Saved.' };
}

/**
 * Read a pasted table WITHOUT writing anything.
 *
 * Two steps on purpose. An import that silently rewrote a schedule and then
 * reported what it had done would be discovered after the fact; this shows the
 * rows and the warnings first, and nothing is written until the person looks at
 * them and presses import.
 */
export async function previewImport(
  _prev: HealthFormState,
  formData: FormData,
): Promise<HealthFormState> {
  await requirePermission('health:edit');

  const parsed = programmeImportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const { rows, warnings, errors } = parseProgrammeTable(parsed.data.table);
  if (errors.length > 0) {
    return { error: errors.join(' '), preview: { rows, warnings } };
  }
  if (rows.length === 0) {
    return { error: 'No entries could be read from that table.' };
  }

  return { preview: { rows, warnings } };
}

export async function confirmImport(
  programmeId: string,
  _prev: HealthFormState,
  formData: FormData,
): Promise<HealthFormState> {
  const principal = await requirePermission('health:edit');

  const parsed = programmeImportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const { rows, errors } = parseProgrammeTable(parsed.data.table);
  if (errors.length > 0) return { error: errors.join(' ') };

  const result = await importProgrammeItems(principal, programmeId, rows, parsed.data.mode);

  await recordAudit({
    principal,
    action: 'healthProgramme.import',
    entityType: 'HealthProgramme',
    entityId: programmeId,
    after: { created: result.created, removed: result.removed, mode: parsed.data.mode },
  });

  revalidatePath(`/health/${programmeId}`);
  return {
    ok:
      `${result.created} entr${result.created === 1 ? 'y' : 'ies'} imported` +
      (result.removed > 0 ? `, ${result.removed} replaced` : '') +
      '. The programme is back to draft until a vet reviews it.',
  };
}

export async function addProgrammeItem(
  programmeId: string,
  _prev: HealthFormState,
  formData: FormData,
): Promise<HealthFormState> {
  const principal = await requirePermission('health:edit');

  const parsed = programmeItemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const input = parsed.data;

  const programme = await db.healthProgramme.findFirst({
    where: { id: programmeId, ...orgFilter(principal) },
    select: { id: true },
  });
  if (!programme) return { error: 'That programme no longer exists.' };

  const count = await db.healthProgrammeItem.count({
    where: { healthProgrammeId: programmeId },
  });

  await db.healthProgrammeItem.create({
    data: {
      healthProgrammeId: programmeId,
      ageDays: input.ageDays,
      windowDays: input.windowDays,
      name: input.name,
      eventType: input.eventType,
      route: input.route,
      dosePerBird: input.dosePerBird,
      eggWithdrawalDays: input.eggWithdrawalDays,
      meatWithdrawalDays: input.meatWithdrawalDays,
      itemId: input.itemId,
      notes: input.notes,
      sortOrder: count,
    },
  });

  // Content changed — any approval no longer covers what is here.
  await touchProgramme(programmeId, { contentChanged: true });

  revalidatePath(`/health/${programmeId}`);
  return { ok: `${input.name} added at day ${input.ageDays}.` };
}

export async function removeProgrammeItem(
  programmeId: string,
  itemId: string,
  _prev: HealthFormState,
  formData: FormData,
): Promise<HealthFormState> {
  const principal = await requirePermission('health:edit');
  if (formData.get('intent') !== 'remove') {
    return { error: 'That request was not understood. Try again.' };
  }

  const item = await db.healthProgrammeItem.findFirst({
    where: {
      id: itemId,
      healthProgrammeId: programmeId,
      programme: orgFilter(principal),
    },
    include: { _count: { select: { events: true } } },
  });
  if (!item) return { error: 'That entry no longer exists.' };

  // An entry something was actually given against is history, not a plan.
  if (item._count.events > 0) {
    return {
      error:
        `${item.name} has ${item._count.events} recorded event${item._count.events === 1 ? '' : 's'} against it. ` +
        `Removing it would orphan the record of a vaccination that actually happened.`,
    };
  }

  await db.healthProgrammeItem.delete({ where: { id: itemId } });
  await touchProgramme(programmeId, { contentChanged: true });

  revalidatePath(`/health/${programmeId}`);
  return { ok: `${item.name} removed.` };
}

/**
 * Record that a named veterinarian has reviewed this programme.
 *
 * Recorded, not asserted: the system knows only what someone typed. What it
 * guarantees is that the name is attached to THIS version — any later edit
 * clears it, so an approval can never end up on a document its approver never
 * saw.
 */
export async function approveProgramme(
  programmeId: string,
  _prev: HealthFormState,
  formData: FormData,
): Promise<HealthFormState> {
  const principal = await requirePermission('health:approve');

  const parsed = approvalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const programme = await db.healthProgramme.findFirst({
    where: { id: programmeId, ...orgFilter(principal) },
    include: { _count: { select: { items: true } } },
  });
  if (!programme) return { error: 'That programme no longer exists.' };
  if (programme._count.items === 0) {
    return { error: 'There is nothing to approve — the programme has no entries yet.' };
  }

  const after = await db.healthProgramme.update({
    where: { id: programmeId },
    data: {
      status: 'APPROVED',
      approvedByName: parsed.data.approvedByName,
      approvedByRole: parsed.data.approvedByRole,
      approvedOn: parsed.data.approvedOn,
    },
  });

  await recordAudit({
    principal,
    action: 'healthProgramme.approve',
    entityType: 'HealthProgramme',
    entityId: programmeId,
    before: programme,
    after,
  });

  revalidatePath('/health');
  revalidatePath(`/health/${programmeId}`);
  return { ok: `Recorded as reviewed by ${after.approvedByName}.` };
}

export async function revokeApproval(
  programmeId: string,
  _prev: HealthFormState,
  formData: FormData,
): Promise<HealthFormState> {
  const principal = await requirePermission('health:approve');
  if (formData.get('intent') !== 'revoke') {
    return { error: 'That request was not understood. Try again.' };
  }

  const before = await db.healthProgramme.findFirst({
    where: { id: programmeId, ...orgFilter(principal) },
  });
  if (!before) return { error: 'That programme no longer exists.' };

  const after = await db.healthProgramme.update({
    where: { id: programmeId },
    data: { status: 'DRAFT', approvedByName: null, approvedByRole: null, approvedOn: null },
  });

  await recordAudit({
    principal,
    action: 'healthProgramme.revoke',
    entityType: 'HealthProgramme',
    entityId: programmeId,
    before,
    after,
  });

  revalidatePath('/health');
  revalidatePath(`/health/${programmeId}`);
  return { ok: 'Approval withdrawn. The programme is back to draft.' };
}

/**
 * Put a flock on a programme, or take it off one.
 *
 * Nothing is copied. The flock points at the programme, so a corrected schedule
 * reaches every flock following it at once — which is the whole reason a vet
 * sends a correction. The trade is that a flock's history is only readable
 * alongside the programme as it stands today; the events themselves record what
 * was actually given, so the record of what happened never moves.
 */
export async function assignProgramme(
  flockId: string,
  _prev: HealthFormState,
  formData: FormData,
): Promise<HealthFormState> {
  const principal = await requirePermission('health:edit');

  const flock = await db.animalGroup.findFirst({
    where: { id: flockId, site: orgFilter(principal) },
    select: { id: true, siteId: true, code: true, healthProgrammeId: true },
  });
  if (!flock) return { error: 'That flock no longer exists.' };
  if (!canAccessSite(principal, flock.siteId)) {
    throw new AuthorizationError('health:edit', flock.siteId);
  }

  const raw = formData.get('healthProgrammeId');
  const programmeId = typeof raw === 'string' && raw !== '' ? raw : null;

  if (programmeId) {
    const programme = await db.healthProgramme.findFirst({
      where: { id: programmeId, ...orgFilter(principal) },
      select: { id: true, name: true },
    });
    if (!programme) return { error: 'That programme no longer exists.' };
  }

  await db.animalGroup.update({
    where: { id: flockId },
    data: { healthProgrammeId: programmeId },
  });

  await recordAudit({
    principal,
    action: 'healthProgramme.update',
    entityType: 'AnimalGroup',
    entityId: flockId,
    before: { healthProgrammeId: flock.healthProgrammeId },
    after: { healthProgrammeId: programmeId },
  });

  revalidatePath(`/flocks/${flockId}`);
  revalidatePath(`/flocks/${flockId}/health`);
  revalidatePath('/health');
  return { ok: programmeId ? 'Programme assigned.' : 'Programme removed from this flock.' };
}

/**
 * Record something that was actually given to a flock.
 *
 * Warn-then-confirm, like the daily record and the goods receipt. The warnings
 * are about the ENTRY — a count larger than the flock, a date a month old, a
 * store that cannot cover it — never about whether the treatment was wise.
 */
export async function recordEvent(
  flockId: string,
  _prev: HealthFormState,
  formData: FormData,
): Promise<HealthFormState> {
  const principal = await requirePermission('health:create');

  const flock = await db.animalGroup.findFirst({
    where: { id: flockId, site: orgFilter(principal) },
    select: { id: true, siteId: true, code: true },
  });
  if (!flock) return { error: 'That flock no longer exists.' };
  if (!canAccessSite(principal, flock.siteId)) {
    throw new AuthorizationError('health:create', flock.siteId);
  }

  const parsed = healthEventSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const result = await recordHealthEvent(principal, flockId, parsed.data);

  if (result.status === 'needsConfirmation') {
    return { warnings: result.warnings, warningToken: result.token };
  }
  if (result.status === 'error') return { error: result.message };

  await recordAudit({
    principal,
    action: 'healthProgramme.update',
    entityType: 'HealthEvent',
    entityId: result.eventId,
    after: {
      flock: flock.code,
      name: parsed.data.name,
      occurredOn: parsed.data.occurredOn.toISOString().slice(0, 10),
      issued: result.issuedBase,
      costPesewas: result.costPesewas,
    },
  });

  revalidatePath(`/flocks/${flockId}/health`);
  revalidatePath('/health');
  revalidatePath('/dashboard');
  redirect(`/flocks/${flockId}/health?recorded=1`);
}
