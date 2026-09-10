/**
 * Roles & permissions — ADRAH Farms
 *
 * ARCHITECTURAL RULE: authorisation is enforced SERVER-SIDE, in one place.
 *
 * Hiding a navigation link is not access control. Every server action and route
 * handler calls `authorize()` before it touches data, and every permission has a
 * test. If a check is missing, the test suite is what notices — not a customer.
 *
 * Permissions are `resource:action` strings. Roles bundle them. Access is
 * additionally SCOPED to sites, so a supervisor at one farm cannot read another.
 */

export const ACTIONS = ['view', 'create', 'edit', 'approve', 'delete', 'export', 'manage'] as const;
export type Action = (typeof ACTIONS)[number];

export const RESOURCES = [
  'site',
  'flock',
  'dailyRecord',
  'production',
  'health',
  'biosecurity',
  'feed',
  'inventory',
  'procurement',
  'supplier',
  'product',
  'price',
  'customer',
  'order',
  'payment',
  'delivery',
  'employee',
  'attendance',
  'task',
  'incident',
  'finance',
  'report',
  'audit',
  'settings',
  'user',
] as const;
export type Resource = (typeof RESOURCES)[number];

export type Permission = `${Resource}:${Action}`;

export const ROLES = [
  'owner',
  'manager',
  'supervisor',
  'worker',
  'storekeeper',
  'sales',
  'driver',
  'vet',
  'customer',
] as const;
export type Role = (typeof ROLES)[number];

/** Every permission on every resource — the owner's bundle. */
function all(resource: Resource): Permission[] {
  return ACTIONS.map((a) => `${resource}:${a}` as Permission);
}

function some(resource: Resource, actions: Action[]): Permission[] {
  return actions.map((a) => `${resource}:${a}` as Permission);
}

/**
 * Every permission the system defines.
 *
 * The type `${Resource}:${Action}` says which strings are well-formed; this says
 * which ones exist. Anything that has to check a permission string it was handed
 * — the alert rule catalogue, a settings screen listing what a role can do —
 * needs the second, because a well-formed permission nobody grants is exactly
 * how a rule ends up invisible to everybody and nobody notices.
 */
export const PERMISSIONS: readonly Permission[] = RESOURCES.flatMap((r) => all(r));

/**
 * The role matrix.
 *
 * Two rules from the specification are enforced here and asserted in the tests:
 *   - A worker sees NO financial information of any kind.
 *   - Sales staff cannot modify flock or health records.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  // Full access, all sites. The only role that can change org settings.
  owner: RESOURCES.flatMap(all),

  // Runs a site end to end, including costs. Cannot change org settings or
  // rewrite the audit trail.
  manager: [
    ...some('site', ['view', 'edit']),
    ...all('flock'),
    ...all('dailyRecord'),
    ...all('production'),
    ...all('health'),
    ...all('biosecurity'),
    ...all('feed'),
    ...all('inventory'),
    ...all('procurement'),
    ...all('supplier'),
    ...some('product', ['view', 'create', 'edit']),
    ...some('price', ['view', 'edit']),
    ...all('customer'),
    ...all('order'),
    ...all('payment'),
    ...all('delivery'),
    ...some('employee', ['view', 'create', 'edit', 'approve']),
    ...all('attendance'),
    ...all('task'),
    ...all('incident'),
    ...some('finance', ['view', 'create', 'edit', 'export']),
    ...some('report', ['view', 'export']),
    ...some('audit', ['view', 'export']),
  ],

  // Operations only. Verifies the records their team enters. No margins, no prices.
  supervisor: [
    ...some('site', ['view']),
    ...some('flock', ['view', 'create', 'edit']),
    ...some('dailyRecord', ['view', 'create', 'edit', 'approve']),
    ...some('production', ['view', 'create', 'edit']),
    ...some('health', ['view', 'create', 'edit']),
    ...some('biosecurity', ['view', 'create', 'edit']),
    ...some('feed', ['view', 'create', 'edit']),
    ...some('inventory', ['view']),
    ...some('employee', ['view']),
    ...some('attendance', ['view', 'create', 'edit', 'approve']),
    ...all('task'),
    ...some('incident', ['view', 'create', 'edit', 'approve']),
    ...some('report', ['view']),
  ],

  // The phone-in-the-house role. Enters what they observe, reports problems.
  // Deliberately has no 'finance', 'price', 'order' or 'customer' permission.
  worker: [
    ...some('flock', ['view']),
    ...some('dailyRecord', ['view', 'create']),
    ...some('production', ['view', 'create']),
    ...some('health', ['view']),
    ...some('biosecurity', ['view', 'create']),
    ...some('feed', ['view', 'create']),
    ...some('task', ['view', 'edit']),
    ...some('incident', ['view', 'create']),
    ...some('attendance', ['view', 'create']),
  ],

  // Owns stock movements. Cannot set prices or see production margins.
  //
  // HOLDS `delivery` BECAUSE THE STORE IS WHERE PRODUCE LEAVES FROM. Sales take
  // the order; the person standing at the store is the one who watches the
  // crates go onto the vehicle, and recording that is the same act as any other
  // stock issue — which this role already owns. Without it, the only people who
  // could write down what left the farm were people who were not there.
  storekeeper: [
    ...some('delivery', ['view', 'create']),
    ...some('inventory', ['view', 'create', 'edit', 'approve']),
    ...some('feed', ['view', 'create', 'edit']),
    ...some('procurement', ['view', 'create', 'edit']),
    ...some('supplier', ['view', 'create', 'edit']),
    ...some('flock', ['view']),
    ...some('task', ['view', 'edit']),
    ...some('incident', ['view', 'create']),
    ...some('report', ['view']),
  ],

  // Takes orders on the phone, at the gate and from WhatsApp.
  // No write access to any animal or health record.
  sales: [
    ...some('product', ['view']),
    ...some('price', ['view']),
    ...all('customer'),
    ...some('order', ['view', 'create', 'edit']),
    ...some('payment', ['view', 'create']),
    ...some('delivery', ['view', 'create']),
    ...some('inventory', ['view']),
    ...some('report', ['view']),
  ],

  // Sees only what is on the vehicle.
  driver: [
    ...some('delivery', ['view', 'edit']),
    ...some('order', ['view']),
    ...some('task', ['view', 'edit']),
    ...some('incident', ['view', 'create']),
    ...some('attendance', ['view', 'create']),
  ],

  // External veterinary user. Health records only, on assigned flocks.
  //
  // Holds `health:approve` because signing off a programme is precisely the act
  // this role exists for. Managers hold it too — in practice a vet emails a
  // schedule and the manager records the approval in their name, since most
  // vets attending a Ghanaian farm will never have an account here.
  vet: [
    ...some('flock', ['view']),
    ...some('health', ['view', 'create', 'edit', 'approve']),
    ...some('biosecurity', ['view']),
    ...some('production', ['view']),
    ...some('report', ['view']),
  ],

  // The public. Their own orders, nothing internal.
  customer: [...some('order', ['view', 'create']), ...some('product', ['view'])],
};

/** Resources a farm worker must never reach, asserted in the permission tests. */
export const FINANCIAL_RESOURCES: readonly Resource[] = ['finance', 'price', 'payment', 'audit'];

export interface Principal {
  userId: string;
  organisationId: string;
  roles: Role[];
  /**
   * Sites this user may act on. An EMPTY array means unrestricted (the owner).
   * This is deliberately explicit rather than a boolean, so adding a second farm
   * later does not silently widen anyone's access.
   */
  siteScope: string[];
}

export class AuthorizationError extends Error {
  readonly permission: Permission;
  readonly siteId?: string;

  constructor(permission: Permission, siteId?: string) {
    super(
      siteId
        ? `Not permitted: ${permission} on site ${siteId}`
        : `Not permitted: ${permission}`,
    );
    this.name = 'AuthorizationError';
    this.permission = permission;
    this.siteId = siteId;
  }
}

/** The union of all permissions granted by a principal's roles. */
export function permissionsFor(principal: Principal): Set<Permission> {
  const set = new Set<Permission>();
  for (const role of principal.roles) {
    for (const p of ROLE_PERMISSIONS[role] ?? []) set.add(p);
  }
  return set;
}

/** Does this principal hold `permission`, and may they act on `siteId`? */
export function can(principal: Principal, permission: Permission, siteId?: string): boolean {
  if (!permissionsFor(principal).has(permission)) return false;
  if (siteId && principal.siteScope.length > 0 && !principal.siteScope.includes(siteId)) {
    return false;
  }
  return true;
}

/**
 * THE GATE. Every server action and route handler calls this before touching data.
 * Throws rather than returning false, so a forgotten `if` cannot leak access.
 */
export function authorize(principal: Principal, permission: Permission, siteId?: string): void {
  if (!can(principal, permission, siteId)) {
    throw new AuthorizationError(permission, siteId);
  }
}

/** Every permission the system knows about — used to seed the Permission table. */
export function allPermissions(): Permission[] {
  return RESOURCES.flatMap(all);
}

export function parsePermission(permission: Permission): { resource: Resource; action: Action } {
  const [resource, action] = permission.split(':') as [Resource, Action];
  return { resource, action };
}
