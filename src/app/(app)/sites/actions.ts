'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { canAccessSite, orgFilter } from '@/lib/scope';
import { AuthorizationError } from '@/lib/rbac';
import {
  siteSchema,
  productionUnitSchema,
  fieldErrorsFrom,
} from '@/lib/validation/site';

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** A short confirmation, for actions that stay on the page rather than redirect. */
  ok?: string;
}

/**
 * Every action below follows the same four steps, in this order:
 *
 *   1. requirePermission()  — throws before anything is read or written
 *   2. validate             — the same Zod schema the form used
 *   3. mutate               — scoped to the principal's organisation
 *   4. recordAudit()        — who, what, before, after
 *
 * The order matters. Validating first would mean an unauthorised caller learns
 * which fields exist and what shape they take.
 */

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

export async function createSite(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePermission('site:create');

  const parsed = siteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  let siteId: string;
  try {
    const site = await db.site.create({
      data: { ...parsed.data, organisationId: principal.organisationId },
    });
    siteId = site.id;
    await recordAudit({
      principal,
      action: 'site.create',
      entityType: 'Site',
      entityId: site.id,
      after: { ...parsed.data },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { fieldErrors: { code: 'That code is already used by another site.' } };
    }
    throw error;
  }

  revalidatePath('/sites');
  redirect(`/sites/${siteId}`);
}

export async function updateSite(
  siteId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const principal = await requirePermission('site:edit', siteId);
  // Belt and braces: the permission check above already scopes by site, but a
  // caller could pass a site from another organisation entirely.
  if (!canAccessSite(principal, siteId)) throw new AuthorizationError('site:edit', siteId);

  const parsed = siteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const before = await db.site.findFirst({
    where: { id: siteId, ...orgFilter(principal) },
  });
  if (!before) return { error: 'That site no longer exists.' };

  try {
    const after = await db.site.update({ where: { id: siteId }, data: parsed.data });
    await recordAudit({
      principal,
      action: 'site.update',
      entityType: 'Site',
      entityId: siteId,
      before,
      after,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { fieldErrors: { code: 'That code is already used by another site.' } };
    }
    throw error;
  }

  revalidatePath('/sites');
  revalidatePath(`/sites/${siteId}`);
  redirect(`/sites/${siteId}`);
}

export async function createProductionUnit(
  siteId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const principal = await requirePermission('site:create', siteId);
  if (!canAccessSite(principal, siteId)) throw new AuthorizationError('site:create', siteId);

  const parsed = productionUnitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const site = await db.site.findFirst({ where: { id: siteId, ...orgFilter(principal) } });
  if (!site) return { error: 'That site no longer exists.' };

  try {
    const unit = await db.productionUnit.create({ data: { ...parsed.data, siteId } });
    await recordAudit({
      principal,
      action: 'productionUnit.create',
      entityType: 'ProductionUnit',
      entityId: unit.id,
      after: { ...parsed.data, siteId },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { fieldErrors: { code: 'That code is already used in this site.' } };
    }
    throw error;
  }

  revalidatePath(`/sites/${siteId}`);
  return {};
}

/**
 * Archive, never delete.
 *
 * A house that held a flock is part of that flock's history. Deleting the row
 * would orphan or cascade away records that are the whole point of the system,
 * so `isActive` goes false and the unit stops appearing in pickers.
 */
export async function archiveProductionUnit(
  unitId: string,
  siteId: string,
): Promise<void> {
  const principal = await requirePermission('site:edit', siteId);
  if (!canAccessSite(principal, siteId)) throw new AuthorizationError('site:edit', siteId);

  const before = await db.productionUnit.findFirst({
    where: { id: unitId, site: { id: siteId, ...orgFilter(principal) } },
  });
  if (!before) return;

  const after = await db.productionUnit.update({
    where: { id: unitId },
    data: { isActive: !before.isActive },
  });

  await recordAudit({
    principal,
    action: 'productionUnit.archive',
    entityType: 'ProductionUnit',
    entityId: unitId,
    before,
    after,
  });

  revalidatePath(`/sites/${siteId}`);
}
