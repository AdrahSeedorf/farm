import { describe, it, expect } from 'vitest';
import {
  can,
  authorize,
  permissionsFor,
  allPermissions,
  AuthorizationError,
  ROLE_PERMISSIONS,
  ROLES,
  FINANCIAL_RESOURCES,
  ACTIONS,
  type Principal,
  type Role,
} from '../rbac';

const principal = (roles: Role[], siteScope: string[] = []): Principal => ({
  userId: 'u1',
  organisationId: 'org1',
  roles,
  siteScope,
});

describe('the role matrix honours the specification', () => {
  it('gives the owner everything', () => {
    const owner = principal(['owner']);
    expect(permissionsFor(owner).size).toBe(allPermissions().length);
    expect(can(owner, 'finance:view')).toBe(true);
    expect(can(owner, 'settings:manage')).toBe(true);
  });

  it('SPEC: a farm worker sees no financial information of any kind', () => {
    const worker = principal(['worker']);
    for (const resource of FINANCIAL_RESOURCES) {
      for (const action of ACTIONS) {
        expect(can(worker, `${resource}:${action}`)).toBe(false);
      }
    }
  });

  it('SPEC: sales staff cannot modify flock or health records', () => {
    const sales = principal(['sales']);
    for (const action of ['create', 'edit', 'delete', 'approve'] as const) {
      expect(can(sales, `flock:${action}`)).toBe(false);
      expect(can(sales, `health:${action}`)).toBe(false);
      expect(can(sales, `dailyRecord:${action}`)).toBe(false);
    }
  });

  it('SPEC: the storekeeper controls stock but cannot set prices', () => {
    const store = principal(['storekeeper']);
    expect(can(store, 'inventory:create')).toBe(true);
    expect(can(store, 'inventory:approve')).toBe(true);
    expect(can(store, 'price:edit')).toBe(false);
    expect(can(store, 'finance:view')).toBe(false);
  });

  it('SPEC: the supervisor runs operations but sees no margins or prices', () => {
    const sup = principal(['supervisor']);
    expect(can(sup, 'dailyRecord:approve')).toBe(true);
    expect(can(sup, 'health:create')).toBe(true);
    expect(can(sup, 'task:manage')).toBe(true);
    expect(can(sup, 'finance:view')).toBe(false);
    expect(can(sup, 'price:view')).toBe(false);
  });

  it('a worker can record what they observe but not delete it', () => {
    const worker = principal(['worker']);
    expect(can(worker, 'dailyRecord:create')).toBe(true);
    expect(can(worker, 'incident:create')).toBe(true);
    expect(can(worker, 'dailyRecord:delete')).toBe(false);
    expect(can(worker, 'flock:edit')).toBe(false);
  });

  it('the driver sees only what is on the vehicle', () => {
    const driver = principal(['driver']);
    expect(can(driver, 'delivery:edit')).toBe(true);
    expect(can(driver, 'order:view')).toBe(true);
    expect(can(driver, 'order:edit')).toBe(false);
    expect(can(driver, 'customer:view')).toBe(false);
    expect(can(driver, 'inventory:view')).toBe(false);
  });

  it('the external vet touches health records and nothing commercial', () => {
    const vet = principal(['vet']);
    expect(can(vet, 'health:create')).toBe(true);
    expect(can(vet, 'flock:view')).toBe(true);
    expect(can(vet, 'finance:view')).toBe(false);
    expect(can(vet, 'employee:view')).toBe(false);
    expect(can(vet, 'inventory:edit')).toBe(false);
  });

  it('a customer reaches nothing internal', () => {
    const customer = principal(['customer']);
    expect(can(customer, 'order:create')).toBe(true);
    expect(can(customer, 'product:view')).toBe(true);
    expect(can(customer, 'flock:view')).toBe(false);
    expect(can(customer, 'inventory:view')).toBe(false);
    expect(can(customer, 'report:view')).toBe(false);
  });
});

/**
 * Milestone 10 added three logs that different people touch for different
 * reasons, and the boundaries between them are easy to get wrong by accident.
 * These assert the shape deliberately rather than leaving it to whatever
 * `all()` happened to expand to.
 */
describe('biosecurity, and who does what', () => {
  it('LETS A WORKER KEEP THE GATE BOOK', () => {
    // The person at the gate when a feed lorry arrives is a farmhand, not the
    // owner. A visitor log only the manager can write is a visitor log with
    // gaps in it exactly where the deliveries were.
    const worker = principal(['worker']);
    expect(can(worker, 'biosecurity:view')).toBe(true);
    expect(can(worker, 'biosecurity:create')).toBe(true);
  });

  it('but does not let them sign a visitor out or rewrite a record', () => {
    const worker = principal(['worker']);
    expect(can(worker, 'biosecurity:edit')).toBe(false);
    expect(can(worker, 'biosecurity:manage')).toBe(false);
  });

  it('THE DOWNTIME RULE IS NOT A WORKER’S TO SET', () => {
    // How many hours this farm asks for is a decision about disease pressure,
    // taken with a vet. It sits behind site:edit, which a worker never holds.
    expect(can(principal(['worker']), 'site:edit')).toBe(false);
    expect(can(principal(['supervisor']), 'site:edit')).toBe(false);
    expect(can(principal(['manager']), 'site:edit')).toBe(true);
  });

  it('a supervisor runs the logs but does not own the checklist', () => {
    const supervisor = principal(['supervisor']);
    expect(can(supervisor, 'biosecurity:create')).toBe(true);
    expect(can(supervisor, 'biosecurity:edit')).toBe(true);
    // Rewording what the farm inspects against is a standard-setting act.
    expect(can(supervisor, 'biosecurity:manage')).toBe(false);
  });

  it('only the owner and the manager shape the checklists', () => {
    for (const role of ROLES) {
      const allowed = role === 'owner' || role === 'manager';
      expect(can(principal([role]), 'biosecurity:manage')).toBe(allowed);
    }
  });

  it('the vet reads the biosecurity record and writes none of it', () => {
    const vet = principal(['vet']);
    expect(can(vet, 'biosecurity:view')).toBe(true);
    expect(can(vet, 'biosecurity:create')).toBe(false);
    expect(can(vet, 'biosecurity:edit')).toBe(false);
  });

  it('nobody commercial touches it at all', () => {
    for (const role of ['sales', 'driver', 'customer'] as const) {
      expect(can(principal([role]), 'biosecurity:view')).toBe(false);
      expect(can(principal([role]), 'biosecurity:create')).toBe(false);
    }
  });

  it('a worker still sees no money on the way past', () => {
    // The biosecurity screens sit next to the costs screens in the navigation.
    // This is the assertion that stops a convenient shortcut being taken later.
    const worker = principal(['worker']);
    expect(can(worker, 'finance:view')).toBe(false);
  });
});

describe('site scoping', () => {
  it('restricts a scoped user to their own sites', () => {
    const supervisor = principal(['supervisor'], ['site-a']);
    expect(can(supervisor, 'dailyRecord:create', 'site-a')).toBe(true);
    expect(can(supervisor, 'dailyRecord:create', 'site-b')).toBe(false);
  });

  it('treats an empty scope as unrestricted, for the owner', () => {
    const owner = principal(['owner'], []);
    expect(can(owner, 'flock:view', 'site-a')).toBe(true);
    expect(can(owner, 'flock:view', 'site-z')).toBe(true);
  });

  it('still requires the permission itself, not just the site', () => {
    const worker = principal(['worker'], ['site-a']);
    expect(can(worker, 'finance:view', 'site-a')).toBe(false);
  });
});

describe('the gate', () => {
  it('throws rather than returning false, so a forgotten if cannot leak access', () => {
    const worker = principal(['worker']);
    expect(() => authorize(worker, 'finance:view')).toThrow(AuthorizationError);
    expect(() => authorize(worker, 'dailyRecord:create')).not.toThrow();
  });

  it('reports the permission and site on the error, for the audit log', () => {
    const sup = principal(['supervisor'], ['site-a']);
    try {
      authorize(sup, 'flock:view', 'site-b');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AuthorizationError);
      expect((e as AuthorizationError).permission).toBe('flock:view');
      expect((e as AuthorizationError).siteId).toBe('site-b');
    }
  });
});

describe('matrix integrity', () => {
  it('defines permissions for every role', () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });

  it('grants no permission that is not in the catalogue', () => {
    const known = new Set(allPermissions());
    for (const role of ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) {
        expect(known.has(p), `${role} has unknown permission ${p}`).toBe(true);
      }
    }
  });

  it('gives no role except the owner blanket settings control', () => {
    for (const role of ROLES) {
      if (role === 'owner') continue;
      expect(can(principal([role]), 'settings:manage')).toBe(false);
    }
  });

  it('combines permissions additively for multi-role users', () => {
    const both = principal(['worker', 'storekeeper']);
    expect(can(both, 'dailyRecord:create')).toBe(true);
    expect(can(both, 'inventory:create')).toBe(true);
    expect(can(both, 'finance:view')).toBe(false);
  });
});

describe('suppliers, and who keeps the list', () => {
  it('LETS THE STOREKEEPER ADD A SUPPLIER', () => {
    // The person who takes the delivery is the person who finds out the mill
    // has a new number. A supplier list only the owner can touch is a supplier
    // list that goes stale, and then somebody rings the old number at 6am.
    const storekeeper = principal(['storekeeper']);
    expect(can(storekeeper, 'supplier:view')).toBe(true);
    expect(can(storekeeper, 'supplier:create')).toBe(true);
    expect(can(storekeeper, 'supplier:edit')).toBe(true);
  });

  it('but archiving is not deleting, and neither is theirs to do outright', () => {
    // Archiving runs through supplier:edit above. supplier:delete exists in the
    // catalogue and is held by nobody but the owner, because a supplier row is
    // what a year of invoices points at.
    expect(can(principal(['storekeeper']), 'supplier:delete')).toBe(false);
    expect(can(principal(['manager']), 'supplier:delete')).toBe(true);
    expect(can(principal(['owner']), 'supplier:delete')).toBe(true);
  });

  it('KEEPS A WORKER OUT OF IT ENTIRELY', () => {
    // Supplier records carry payment terms. A worker sees no commercial terms
    // anywhere else in the system and must not see them here either.
    const worker = principal(['worker']);
    expect(can(worker, 'supplier:view')).toBe(false);
    expect(can(worker, 'supplier:create')).toBe(false);
  });

  it('and out of sales staff’s way too — they buy nothing', () => {
    expect(can(principal(['sales']), 'supplier:view')).toBe(false);
    expect(can(principal(['sales']), 'procurement:view')).toBe(false);
  });
});
