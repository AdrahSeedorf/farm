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
