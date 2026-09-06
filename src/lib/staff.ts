import { ROLES, ROLE_PERMISSIONS, type Permission, type Role } from '@/lib/rbac';
import { pinIsPermittedFor } from '@/lib/pin';

/**
 * Staff account rules — ADRAH Farms
 *
 * Pure. No database.
 *
 * THIS FILE IS THE PRIVILEGE-ESCALATION SURFACE, and everything in it exists
 * because "who may create accounts" is the one permission that can be used to
 * grant itself more. A manager who can hand out the owner role is an owner; a
 * supervisor who can widen their own site scope covers every farm. Neither of
 * those is obvious from the role matrix, which is exactly why they get their own
 * file with their own tests.
 *
 * THE ONE RULE EVERYTHING ELSE FOLLOWS: nobody may grant what they do not hold.
 * Not roles, not sites, not credentials. It is checked server-side on every
 * write, and the screens merely avoid offering what would be refused.
 */

/**
 * Roles this person may hand out.
 *
 * A role is grantable when everything it confers is already held by the person
 * granting it. Comparing PERMISSION SETS rather than a hard-coded hierarchy
 * matters: the role matrix is edited as the farm changes, and a list of "who
 * outranks whom" maintained separately from it would drift, silently, in the
 * direction of letting somebody grant more than they hold.
 *
 * The owner holds every permission, so the owner may grant every role — which
 * is the intended and only route to creating another owner.
 */
export function grantableRoles(actorRoles: Role[]): Role[] {
  const held = new Set<Permission>(actorRoles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []));
  return ROLES.filter((role) => ROLE_PERMISSIONS[role].every((p) => held.has(p)));
}

/** Reasons a set of roles may not be granted by this person. These BLOCK. */
export function roleGrantErrors(actorRoles: Role[], wanted: Role[]): string[] {
  if (wanted.length === 0) {
    return ['Give this person at least one role. An account with none can sign in and see nothing.'];
  }

  const grantable = new Set(grantableRoles(actorRoles));
  const refused = wanted.filter((r) => !grantable.has(r));

  if (refused.length === 0) return [];

  return [
    `You cannot give somebody ${refused.join(' or ')} — that role can do things your own ` +
      'account cannot. Ask the owner to make this change.',
  ];
}

/**
 * Reasons a site scope may not be granted.
 *
 * AN EMPTY SCOPE MEANS EVERY SITE — the convention set in scope.ts — so
 * "granting nothing" is the widest possible grant, not the narrowest. Somebody
 * restricted to one farm handing out an empty scope would be handing out access
 * to farms they cannot see themselves, which is why the empty case is checked
 * first and explicitly.
 */
export function scopeGrantErrors(actorScope: string[], wantedScope: string[]): string[] {
  const actorIsUnrestricted = actorScope.length === 0;
  if (actorIsUnrestricted) return [];

  if (wantedScope.length === 0) {
    return [
      'You cannot give somebody access to every farm, because your own account does not ' +
        'have it. Choose the farms explicitly.',
    ];
  }

  const allowed = new Set(actorScope);
  const outside = wantedScope.filter((s) => !allowed.has(s));
  return outside.length === 0
    ? []
    : ['You cannot give somebody access to a farm you do not cover yourself.'];
}

/**
 * Reasons somebody may not make this change TO THEMSELVES.
 *
 * Both of these are locked doors with the key on the inside. Neither is a
 * security control against a hostile actor — somebody who wants to lock
 * themselves out can — they are guards against the ordinary Tuesday-afternoon
 * mistake that leaves a farm with no way back into its own system.
 */
export function selfChangeErrors(
  actorId: string,
  targetId: string,
  change: { deactivating?: boolean; roles?: Role[] },
): string[] {
  if (actorId !== targetId) return [];
  const errors: string[] = [];

  if (change.deactivating) {
    errors.push('You cannot deactivate your own account. Ask somebody else to do it.');
  }

  if (change.roles && !change.roles.includes('owner')) {
    // Checked here rather than only at "the last owner", because a farm with two
    // owners where one removes their own role is one accident away from none.
    errors.push(
      'You cannot remove your own owner role. If you are handing the farm over, make the ' +
        'other person an owner first, then have them remove yours.',
    );
  }

  return errors;
}

/**
 * Reasons the LAST owner may not be changed or removed.
 *
 * A farm with no owner has no route to organisation settings, no route to
 * creating users, and therefore no route back. Restoring it means somebody with
 * database access, which on a Sunday means nobody.
 */
export function lastOwnerErrors(input: {
  targetIsOwner: boolean;
  otherActiveOwners: number;
  deactivating?: boolean;
  newRoles?: Role[];
}): string[] {
  if (!input.targetIsOwner || input.otherActiveOwners > 0) return [];

  const losingOwner = input.deactivating || (input.newRoles && !input.newRoles.includes('owner'));
  return losingOwner
    ? [
        'This is the only owner. Removing that leaves the farm with nobody who can reach ' +
          'settings or create accounts, and there is no way back from inside the system. ' +
          'Make somebody else an owner first.',
      ]
    : [];
}

export type PinConsequence =
  | { kind: 'none' }
  | { kind: 'revoked'; message: string }
  | { kind: 'refused'; message: string };

/**
 * What happens to an existing PIN when somebody's roles change.
 *
 * THE HOLE THIS CLOSES. `pinIsPermittedFor` stops a PIN being SET on an account
 * that can see money. It does nothing about the other direction: giving the
 * manager role to a farmhand who already has a PIN would put the whole finance
 * side behind six digits, and every check in pin.ts would have been passed
 * honestly on the way there.
 *
 * The PIN is REVOKED rather than the change refused. Promoting somebody is a
 * normal thing a farm does and should not be blocked by a credential; what must
 * not happen is the promotion quietly carrying the credential with it. They get
 * a password instead, and the screen says so at the moment it happens.
 */
export function pinConsequenceOf(newRoles: Role[], hasPin: boolean): PinConsequence {
  if (!hasPin) return { kind: 'none' };

  const verdict = pinIsPermittedFor(newRoles);
  if (verdict.allowed) return { kind: 'none' };

  return {
    kind: 'revoked',
    message:
      'Their PIN has been removed. This account can now see money or change access, and ' +
      'six digits is not the right credential for that — set them a password instead. ' +
      'They cannot sign in until you do.',
  };
}

/**
 * A one-line summary of what an account can reach, for the list screen.
 *
 * Written from PERMISSIONS rather than role names, because "manager" tells
 * somebody setting up an account nothing about whether that person will see the
 * flock's cost per bird.
 */
export function reachSentence(roles: Role[]): string {
  const held = new Set<Permission>(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []));

  const notes: string[] = [];
  if (held.has('finance:view')) notes.push('sees costs and margins');
  if (held.has('price:edit')) notes.push('sets prices');
  if (held.has('user:create')) notes.push('creates accounts');
  if (held.has('settings:manage')) notes.push('changes farm settings');
  if (notes.length === 0) notes.push('records what happens on the farm');

  return notes.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.';
}
