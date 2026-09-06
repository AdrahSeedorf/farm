import { describe, it, expect } from 'vitest';
import {
  grantableRoles,
  roleGrantErrors,
  scopeGrantErrors,
  selfChangeErrors,
  lastOwnerErrors,
  pinConsequenceOf,
  reachSentence,
} from '../staff';
import { ROLES, ROLE_PERMISSIONS } from '../rbac';

describe('nobody may grant what they do not hold', () => {
  it('THE OWNER MAY GRANT EVERY ROLE, including another owner', () => {
    // The only route to a second owner, and it has to exist — a farm with one
    // owner and no way to make another is one lost phone from a locked door.
    expect(grantableRoles(['owner'])).toEqual([...ROLES]);
  });

  it('A MANAGER MAY NOT GRANT OWNER', () => {
    // The escalation this whole file exists to stop: a manager who can hand out
    // the owner role is an owner, whatever the role matrix says.
    expect(grantableRoles(['manager'])).not.toContain('owner');
    expect(roleGrantErrors(['manager'], ['owner'])[0]).toMatch(/cannot give somebody owner/i);
    expect(roleGrantErrors(['manager'], ['owner'])[0]).toMatch(/ask the owner/i);
  });

  it('but may grant the roles beneath their own', () => {
    const grantable = grantableRoles(['manager']);
    expect(grantable).toContain('worker');
    expect(grantable).toContain('storekeeper');
    expect(roleGrantErrors(['manager'], ['worker', 'storekeeper'])).toEqual([]);
  });

  it('A SUPERVISOR MAY NOT GRANT MANAGER', () => {
    expect(grantableRoles(['supervisor'])).not.toContain('manager');
    expect(grantableRoles(['supervisor'])).not.toContain('owner');
  });

  it('IS DERIVED FROM PERMISSIONS, not a hard-coded hierarchy', () => {
    // A separate "who outranks whom" list would drift from the role matrix as
    // the farm changes, silently, in the direction of granting too much. This
    // asserts the derivation rather than the answer: every grantable role's
    // permissions are a subset of the granter's.
    for (const actor of ROLES) {
      const held = new Set(ROLE_PERMISSIONS[actor]);
      for (const grantable of grantableRoles([actor])) {
        for (const p of ROLE_PERMISSIONS[grantable]) {
          expect(held.has(p), `${actor} should not be able to grant ${grantable}`).toBe(true);
        }
      }
    }
  });

  it('combines the granter’s roles additively', () => {
    // Somebody who is both a storekeeper and a supervisor may grant anything
    // covered by the union, which is more than either alone.
    const both = grantableRoles(['storekeeper', 'supervisor']);
    expect(both.length).toBeGreaterThanOrEqual(grantableRoles(['supervisor']).length);
  });

  it('refuses an account with no role at all', () => {
    expect(roleGrantErrors(['owner'], [])[0]).toMatch(/at least one role/i);
  });
});

describe('nobody may grant a farm they do not cover', () => {
  it('an unrestricted person may grant anything', () => {
    expect(scopeGrantErrors([], ['site-a', 'site-b'])).toEqual([]);
    expect(scopeGrantErrors([], [])).toEqual([]);
  });

  it('AN EMPTY SCOPE IS THE WIDEST GRANT, NOT THE NARROWEST', () => {
    // The convention from scope.ts: no rows means every site. So a supervisor
    // "granting nothing" would be granting everything, which is the opposite of
    // what the screen looks like it is doing.
    expect(scopeGrantErrors(['site-a'], [])[0]).toMatch(/access to every farm/i);
    expect(scopeGrantErrors(['site-a'], [])[0]).toMatch(/choose the farms explicitly/i);
  });

  it('refuses a farm outside the granter’s own scope', () => {
    expect(scopeGrantErrors(['site-a'], ['site-b'])[0]).toMatch(/a farm you do not cover/i);
    expect(scopeGrantErrors(['site-a'], ['site-a', 'site-b'])).toHaveLength(1);
  });

  it('allows a subset of it', () => {
    expect(scopeGrantErrors(['site-a', 'site-b'], ['site-a'])).toEqual([]);
  });
});

describe('the locked door with the key on the inside', () => {
  it('NOBODY DEACTIVATES THEMSELVES', () => {
    expect(selfChangeErrors('u1', 'u1', { deactivating: true })[0]).toMatch(
      /cannot deactivate your own account/i,
    );
  });

  it('and nobody removes their own owner role', () => {
    expect(selfChangeErrors('u1', 'u1', { roles: ['manager'] })[0]).toMatch(
      /cannot remove your own owner role/i,
    );
    expect(selfChangeErrors('u1', 'u1', { roles: ['owner', 'manager'] })).toEqual([]);
  });

  it('none of which applies to somebody else', () => {
    expect(selfChangeErrors('u1', 'u2', { deactivating: true, roles: ['worker'] })).toEqual([]);
  });

  it('THE LAST OWNER CANNOT BE REMOVED, by anyone', () => {
    // There is no route back from a farm with no owner that does not involve
    // somebody with database access, which on a Sunday means nobody.
    expect(
      lastOwnerErrors({ targetIsOwner: true, otherActiveOwners: 0, deactivating: true })[0],
    ).toMatch(/only owner/i);
    expect(
      lastOwnerErrors({ targetIsOwner: true, otherActiveOwners: 0, newRoles: ['manager'] })[0],
    ).toMatch(/no way back from inside the system/i);
  });

  it('but the second-to-last one can', () => {
    expect(
      lastOwnerErrors({ targetIsOwner: true, otherActiveOwners: 1, deactivating: true }),
    ).toEqual([]);
  });

  it('and an owner who stays an owner is untouched', () => {
    expect(
      lastOwnerErrors({ targetIsOwner: true, otherActiveOwners: 0, newRoles: ['owner'] }),
    ).toEqual([]);
  });
});

describe('what a promotion does to a PIN', () => {
  it('NOTHING, when the new roles are still PIN-appropriate', () => {
    expect(pinConsequenceOf(['worker', 'supervisor'], true).kind).toBe('none');
  });

  it('AND REVOKES IT WHEN THEY ARE NOT', () => {
    // The hole this closes: pinIsPermittedFor stops a PIN being SET on a manager.
    // It does nothing about promoting a farmhand who already has one, which
    // would put the finance side behind six digits with every check passed
    // honestly on the way there.
    const consequence = pinConsequenceOf(['manager'], true);
    expect(consequence.kind).toBe('revoked');
    expect(consequence.kind === 'revoked' && consequence.message).toMatch(/PIN has been removed/i);
  });

  it('says what to do next, and that they are locked out until it is done', () => {
    const consequence = pinConsequenceOf(['owner'], true);
    expect(consequence.kind === 'revoked' && consequence.message).toMatch(/password instead/i);
    expect(consequence.kind === 'revoked' && consequence.message).toMatch(
      /cannot sign in until you do/i,
    );
  });

  it('REVOKES RATHER THAN REFUSING — promoting somebody is normal', () => {
    // Blocking the promotion would mean a farm cannot make a farmhand a manager
    // without first understanding a credential rule. The change goes through;
    // it just does not carry the PIN with it.
    expect(pinConsequenceOf(['manager'], true).kind).not.toBe('refused');
  });

  it('and does nothing at all to an account with no PIN', () => {
    expect(pinConsequenceOf(['owner'], false).kind).toBe('none');
  });
});

describe('what an account can actually reach', () => {
  it('says it in terms of money and access, not role names', () => {
    // "Manager" tells somebody setting up an account nothing about whether that
    // person will see the flock's cost per bird.
    expect(reachSentence(['owner'])).toMatch(/sees costs and margins/i);
    expect(reachSentence(['owner'])).toMatch(/creates accounts/i);
    expect(reachSentence(['worker'])).toBe('Records what happens on the farm.');
  });

  it('and never leaves an account looking harmless when it is not', () => {
    for (const role of ROLES) {
      const sentence = reachSentence([role]);
      const held = new Set(ROLE_PERMISSIONS[role]);
      if (held.has('finance:view')) {
        expect(sentence, role).toMatch(/costs and margins/i);
      }
    }
  });
});
