import 'server-only';
import { db } from '@/lib/db';
import type { Principal, Role } from '@/lib/rbac';
import { orgFilter } from '@/lib/scope';
import { hashPassword, hashPin } from '@/lib/password';
import { toE164, formatGhanaPhone } from '@/lib/ghana';
import { pinErrors, pinIsPermittedFor } from '@/lib/pin';
import {
  grantableRoles,
  roleGrantErrors,
  scopeGrantErrors,
  selfChangeErrors,
  lastOwnerErrors,
  pinConsequenceOf,
  reachSentence,
  type PinConsequence,
} from '@/lib/staff';
import type { StaffInput } from '@/lib/validation/staff';

/**
 * Staff accounts — ADRAH Farms
 *
 * THE ONLY PLACE A User, UserRole OR UserSiteScope IS WRITTEN.
 *
 * Every rule in staff.ts is applied HERE, on the server, on every write. The
 * screens hide what would be refused, but hiding is a courtesy: somebody posting
 * this form by hand gets exactly the same answers.
 *
 * ACCOUNTS ARE DEACTIVATED, NEVER DELETED. Every mortality, every delivery and
 * every cost entry on this farm names the person who recorded it, and a
 * `recordedBy` pointing at nothing turns a year of records into a year of
 * anonymous ones.
 */

export class StaffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaffError';
  }
}

export type Credential = 'PASSWORD' | 'PIN' | 'BOTH' | 'NONE';

export interface StaffRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  phoneDisplay: string | null;
  roles: Role[];
  /** Empty means every farm — the convention from scope.ts. */
  siteIds: string[];
  siteNames: string[];
  everySite: boolean;
  credential: Credential;
  /** What this account can actually reach, in words. */
  reach: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  isActive: boolean;
  isSelf: boolean;
}

function credentialOf(user: { passwordHash: string | null; pinHash: string | null }): Credential {
  if (user.passwordHash && user.pinHash) return 'BOTH';
  if (user.passwordHash) return 'PASSWORD';
  if (user.pinHash) return 'PIN';
  return 'NONE';
}

function toRow(
  user: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    passwordHash: string | null;
    pinHash: string | null;
    mustChangePassword: boolean;
    lastLoginAt: Date | null;
    isActive: boolean;
    roles: { role: { key: string } }[];
    siteScopes: { site: { id: string; name: string } }[];
  },
  principal: Principal,
): StaffRow {
  const roles = user.roles.map((r) => r.role.key as Role);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    phoneDisplay: formatGhanaPhone(user.phone),
    roles,
    siteIds: user.siteScopes.map((s) => s.site.id),
    siteNames: user.siteScopes.map((s) => s.site.name),
    everySite: user.siteScopes.length === 0,
    credential: credentialOf(user),
    reach: reachSentence(roles),
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    isActive: user.isActive,
    isSelf: user.id === principal.userId,
  };
}

const include = {
  roles: { select: { role: { select: { key: true } } } },
  siteScopes: { select: { site: { select: { id: true, name: true } } } },
} as const;

export async function listStaff(
  principal: Principal,
  includeInactive = false,
): Promise<StaffRow[]> {
  const users = await db.user.findMany({
    where: { ...orgFilter(principal), ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include,
  });
  return users.map((u) => toRow(u, principal));
}

export async function staffById(
  principal: Principal,
  userId: string,
): Promise<StaffRow | null> {
  const user = await db.user.findFirst({
    where: { id: userId, ...orgFilter(principal) },
    include,
  });
  return user ? toRow(user, principal) : null;
}

/**
 * What this person may offer on the form.
 *
 * The lists are narrowed to what the actor may actually grant, so the screen
 * does not present a choice the server is going to refuse. The refusal still
 * exists — see the checks in every write below — because a narrowed list is a
 * convenience, not a control.
 */
export async function staffContext(principal: Principal) {
  const sites = await db.site.findMany({
    where: {
      ...orgFilter(principal),
      isActive: true,
      ...(principal.siteScope.length > 0 ? { id: { in: principal.siteScope } } : {}),
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  return {
    sites,
    roles: grantableRoles(principal.roles),
    /** False for a supervisor: they cannot hand out access they do not have. */
    mayGrantEverySite: principal.siteScope.length === 0,
  };
}

/** How many OTHER active owners there are. Used by the last-owner guard. */
async function otherActiveOwners(
  organisationId: string,
  excludingUserId: string,
): Promise<number> {
  return db.user.count({
    where: {
      organisationId,
      isActive: true,
      id: { not: excludingUserId },
      roles: { some: { role: { key: 'owner' } } },
    },
  });
}

async function roleIdsFor(keys: string[]): Promise<string[]> {
  const rows = await db.role.findMany({ where: { key: { in: keys } }, select: { id: true } });
  if (rows.length !== keys.length) {
    throw new StaffError('One of those roles is not set up on this system.');
  }
  return rows.map((r) => r.id);
}

/** Refuse anything staff.ts refuses, with the first reason given. */
function refuseIfAny(...errorLists: string[][]): void {
  for (const list of errorLists) {
    if (list.length > 0) throw new StaffError(list[0]);
  }
}

export interface StaffWriteResult {
  id: string;
  /** Set when a role change took somebody's PIN away. Shown, not swallowed. */
  pinConsequence: PinConsequence;
}

export async function createStaff(
  principal: Principal,
  input: StaffInput,
  roles: string[],
  scope: { everySite: boolean; siteIds: string[] },
): Promise<StaffWriteResult> {
  const wanted = roles as Role[];
  refuseIfAny(
    roleGrantErrors(principal.roles, wanted),
    scopeGrantErrors(principal.siteScope, scope.everySite ? [] : scope.siteIds),
  );

  // Normalised before storage AND before the uniqueness check, so the same
  // number typed two ways cannot become two accounts — which would then be two
  // separate rate-limit allowances on one person's PIN.
  const phone = input.phone ? toE164(input.phone) : null;
  if (input.phone && !phone) {
    throw new StaffError(
      'That phone number is not one this system can dial. Check the digits — staff sign in with it.',
    );
  }

  await refuseIfTaken(input.email, phone, null);

  const roleIds = await roleIdsFor(wanted);
  const created = await db.user.create({
    data: {
      organisationId: principal.organisationId,
      name: input.name,
      email: input.email,
      phone,
      isActive: true,
      // No credential yet. Set on the next screen, deliberately: a password
      // typed on the same form as a name gets chosen carelessly, and a PIN
      // shown beside an email field gets typed into the email field.
      roles: { create: roleIds.map((roleId) => ({ roleId })) },
      ...(scope.everySite
        ? {}
        : { siteScopes: { create: scope.siteIds.map((siteId) => ({ siteId })) } }),
    },
    select: { id: true },
  });

  return { id: created.id, pinConsequence: { kind: 'none' } };
}

export async function updateStaff(
  principal: Principal,
  userId: string,
  input: StaffInput,
  roles: string[],
  scope: { everySite: boolean; siteIds: string[] },
): Promise<StaffWriteResult> {
  const target = await db.user.findFirst({
    where: { id: userId, ...orgFilter(principal) },
    include,
  });
  if (!target) throw new StaffError('That account no longer exists.');

  const wanted = roles as Role[];
  const targetIsOwner = target.roles.some((r) => r.role.key === 'owner');

  refuseIfAny(
    roleGrantErrors(principal.roles, wanted),
    scopeGrantErrors(principal.siteScope, scope.everySite ? [] : scope.siteIds),
    selfChangeErrors(principal.userId, userId, { roles: wanted }),
    lastOwnerErrors({
      targetIsOwner,
      otherActiveOwners: await otherActiveOwners(principal.organisationId, userId),
      newRoles: wanted,
    }),
  );

  // YOU MAY NOT EDIT SOMEBODY WHO OUTRANKS YOU. Without this, a manager could
  // not GRANT the owner role but could still rename, re-scope or re-credential
  // the owner's own account — which is the same power by a longer route.
  const existing = target.roles.map((r) => r.role.key as Role);
  refuseIfAny(editableCheck(principal, existing, userId));

  const phone = input.phone ? toE164(input.phone) : null;
  if (input.phone && !phone) {
    throw new StaffError(
      'That phone number is not one this system can dial. Check the digits — staff sign in with it.',
    );
  }
  await refuseIfTaken(input.email, phone, userId);

  // A promotion must not carry a PIN with it into territory where six digits is
  // the wrong credential. See pinConsequenceOf.
  const consequence = pinConsequenceOf(wanted, target.pinHash !== null);

  const roleIds = await roleIdsFor(wanted);
  await db.$transaction([
    db.userRole.deleteMany({ where: { userId } }),
    db.userSiteScope.deleteMany({ where: { userId } }),
    db.user.update({
      where: { id: userId },
      data: {
        name: input.name,
        email: input.email,
        phone,
        ...(consequence.kind === 'revoked' ? { pinHash: null } : {}),
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
        ...(scope.everySite
          ? {}
          : { siteScopes: { create: scope.siteIds.map((siteId) => ({ siteId })) } }),
      },
    }),
  ]);

  return { id: userId, pinConsequence: consequence };
}

/**
 * Set somebody's PIN.
 *
 * THE PIN IS NEVER READ BACK. It is hashed here and returned to the caller
 * exactly once, in memory, so the screen can show it to whoever is standing next
 * to the person it belongs to. After that page render it exists nowhere but in
 * that person's head.
 */
export async function setStaffPin(
  principal: Principal,
  userId: string,
  pin: string,
): Promise<void> {
  const target = await db.user.findFirst({
    where: { id: userId, ...orgFilter(principal) },
    include,
  });
  if (!target) throw new StaffError('That account no longer exists.');

  const roles = target.roles.map((r) => r.role.key as Role);
  refuseIfAny(editableCheck(principal, roles, userId));

  const verdict = pinIsPermittedFor(roles);
  if (!verdict.allowed) throw new StaffError(verdict.reason!);

  const problems = pinErrors(pin, target.phone);
  if (problems.length > 0) throw new StaffError(problems.join(' '));

  if (!target.phone) {
    throw new StaffError(
      'Give them a phone number first — the PIN is only half of it, and there is nothing ' +
        'to type it against.',
    );
  }

  await db.user.update({ where: { id: userId }, data: { pinHash: await hashPin(pin) } });
}

export async function setStaffPassword(
  principal: Principal,
  userId: string,
  password: string,
): Promise<void> {
  const target = await db.user.findFirst({
    where: { id: userId, ...orgFilter(principal) },
    include,
  });
  if (!target) throw new StaffError('That account no longer exists.');
  refuseIfAny(editableCheck(principal, target.roles.map((r) => r.role.key as Role), userId));

  if (!target.email) {
    throw new StaffError('Give them an email address first — that is what they sign in with.');
  }

  await db.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(password),
      // Anything an administrator typed is known to at least two people, so it
      // is a way in, not a credential. The next sign-in has to replace it.
      mustChangePassword: true,
    },
  });
}

export async function setStaffActive(
  principal: Principal,
  userId: string,
  isActive: boolean,
): Promise<string> {
  const target = await db.user.findFirst({
    where: { id: userId, ...orgFilter(principal) },
    include,
  });
  if (!target) throw new StaffError('That account no longer exists.');

  const roles = target.roles.map((r) => r.role.key as Role);
  refuseIfAny(
    editableCheck(principal, roles, userId),
    selfChangeErrors(principal.userId, userId, { deactivating: !isActive }),
    lastOwnerErrors({
      targetIsOwner: roles.includes('owner'),
      otherActiveOwners: await otherActiveOwners(principal.organisationId, userId),
      deactivating: !isActive,
    }),
  );

  await db.user.update({ where: { id: userId }, data: { isActive } });
  return target.name;
}

/**
 * May this person act on an account holding these roles?
 *
 * The same subset rule as granting, applied to the TARGET. A manager who cannot
 * create an owner must also not be able to rename one, move them between farms,
 * or set their password — each of which is a route to the same place.
 *
 * Everybody may act on their own account, which is what makes "change my own
 * password" possible without a second mechanism.
 */
function editableCheck(principal: Principal, targetRoles: Role[], targetId: string): string[] {
  if (principal.userId === targetId) return [];
  const grantable = new Set(grantableRoles(principal.roles));
  const above = targetRoles.filter((r) => !grantable.has(r));
  return above.length === 0
    ? []
    : [
        `This account holds the ${above.join(' and ')} role, which your own account cannot ` +
          'grant. Somebody with that role has to make the change.',
      ];
}

/**
 * Email and phone are unique ACROSS THE WHOLE SYSTEM, not per organisation —
 * that is what the schema says, and the message has to make sense for it.
 */
async function refuseIfTaken(
  email: string | null,
  phone: string | null,
  excludingUserId: string | null,
): Promise<void> {
  for (const [field, value, label] of [
    ['email', email, 'email address'],
    ['phone', phone, 'phone number'],
  ] as const) {
    if (!value) continue;
    const clash = await db.user.findFirst({
      where: { [field]: value, ...(excludingUserId ? { id: { not: excludingUserId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      throw new StaffError(`That ${label} already belongs to another account.`);
    }
  }
}
