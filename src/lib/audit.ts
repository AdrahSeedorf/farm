import { headers } from 'next/headers';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';

/**
 * Audit logging — ADRAH Farms
 *
 * Records WHO changed WHAT, WHEN, and FROM WHAT TO WHAT.
 *
 * Wired up at Milestone 2 rather than later on purpose. An audit trail added
 * after the fact is an audit trail with a hole in it exactly where the
 * interesting history would have been — and on a farm the interesting history is
 * things like "who changed the price on the day that order went out" and "who
 * adjusted the bird count the week the numbers stopped adding up".
 *
 * WHAT IS NOT RECORDED
 *   - Password hashes, PINs, or any secret. `redact()` strips them.
 *   - Unchanged fields. Storing a whole row on every save makes the log
 *     unreadable, which makes it unread.
 */

export type AuditAction =
  | 'organisation.update'
  | 'site.create'
  | 'site.update'
  | 'site.archive'
  | 'productionUnit.create'
  | 'productionUnit.update'
  | 'productionUnit.archive'
  | 'supplier.create'
  | 'supplier.update'
  | 'supplier.archive'
  | 'order.create'
  | 'order.update'
  | 'order.line.add'
  | 'order.line.remove'
  | 'order.send'
  | 'order.cancel'
  | 'order.receive'
  | 'attendance.clockIn'
  | 'attendance.clockOut'
  | 'attendance.correct'
  | 'task.create'
  | 'task.update'
  | 'task.complete'
  | 'task.reopen'
  | 'task.cancel'
  | 'item.create'
  | 'item.update'
  | 'item.archive'
  | 'stockLocation.create'
  | 'stockLocation.produce'
  | 'stock.receipt'
  | 'stock.writeOff'
  | 'healthProgramme.create'
  | 'healthProgramme.update'
  | 'healthProgramme.import'
  | 'healthProgramme.approve'
  | 'healthProgramme.revoke'
  | 'visitor.log'
  | 'cleaning.record'
  | 'checklist.create'
  | 'check.record'
  | 'visitor.signOut'
  | 'cost.allocate'
  | 'cost.reverse'
  | 'production.record'
  | 'production.correct'
  | 'productionGrade.create'
  | 'productionGrade.update'
  | 'productionGrade.archive'
  | 'user.create'
  | 'user.update'
  | 'user.deactivate'
  | 'permission.change'
  | 'price.change'
  | 'stock.adjust'
  | 'population.adjust'
  | 'record.correct'
  | 'record.delete';

type Row = Record<string, unknown>;

/**
 * Values that survive the trip into a Postgres `jsonb` column.
 *
 * The round-trip in `toJson` below is not defensive typing for its own sake: a
 * Prisma model row carries `Date` objects, and can carry `Decimal` or `BigInt`,
 * none of which are JSON. Passing one straight to a Json column throws at
 * runtime — inside the audit writer, where the failure is least visible.
 */
type JsonObject = Record<string, string | number | boolean | null | object>;

function toJson(value: Row): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

/** Field names never written to the audit log, at any nesting level. */
const SECRET_KEYS = new Set([
  'passwordHash',
  'pinHash',
  'password',
  'pin',
  'token',
  'secret',
  'apiKey',
]);

function redact(value: Row): Row {
  const out: Row = {};
  for (const [key, v] of Object.entries(value)) {
    if (SECRET_KEYS.has(key)) continue;
    out[key] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

/**
 * Reduce before/after to only the fields that actually changed.
 * Exported because it is worth testing directly — a diff that quietly drops a
 * change is worse than no diff at all.
 */
export function diffFields(
  before: Row | null,
  after: Row | null,
): { before: Row; after: Row } | null {
  if (!before && !after) return null;
  if (!before) return { before: {}, after: redact(after!) };
  if (!after) return { before: redact(before), after: {} };

  const cleanBefore = redact(before);
  const cleanAfter = redact(after);
  const changedBefore: Row = {};
  const changedAfter: Row = {};

  for (const key of new Set([...Object.keys(cleanBefore), ...Object.keys(cleanAfter)])) {
    const a = cleanBefore[key];
    const b = cleanAfter[key];
    if (!Object.is(a, b) && JSON.stringify(a) !== JSON.stringify(b)) {
      changedBefore[key] = a ?? null;
      changedAfter[key] = b ?? null;
    }
  }

  if (Object.keys(changedAfter).length === 0 && Object.keys(changedBefore).length === 0) {
    return null; // a save that changed nothing is not an event
  }
  return { before: changedBefore, after: changedAfter };
}

export interface AuditInput {
  principal: Principal;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: Row | null;
  after?: Row | null;
}

/**
 * Write an audit entry.
 *
 * NEVER throws. An audit failure must not roll back or block the business
 * operation the user actually asked for — a farm that cannot record a mortality
 * because the log table is full is a worse outcome than a gap in the log. The
 * failure is surfaced to the server console for the alerting pipeline instead.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const changes = diffFields(input.before ?? null, input.after ?? null);

    let ipAddress: string | null = null;
    let userAgent: string | null = null;
    try {
      const headerList = await headers();
      ipAddress =
        headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        headerList.get('x-real-ip') ??
        null;
      userAgent = headerList.get('user-agent')?.slice(0, 255) ?? null;
    } catch {
      // Called outside a request (a job, a script) — headers are unavailable.
    }

    await db.auditLog.create({
      data: {
        organisationId: input.principal.organisationId,
        actorId: input.principal.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: changes ? toJson(changes.before) : undefined,
        after: changes ? toJson(changes.after) : undefined,
        ipAddress,
        userAgent,
      },
    });
  } catch (error) {
    console.error('AUDIT WRITE FAILED', {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
