import { cache } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { authorize, can, type Permission, type Principal } from '@/lib/rbac';

/**
 * Session → Principal — ADRAH Farms
 *
 * THE SECURITY BOUNDARY IS HERE, NOT IN THE PROXY.
 *
 * Route-level middleware is a convenience, not a control. Next.js has shipped
 * more than one middleware-bypass vulnerability, and a request that reaches a
 * server action directly never passes through the proxy at all. So every server
 * component, server action and route handler that touches data calls one of the
 * functions below. There is no other sanctioned way to read the current user.
 *
 * ── PERFORMANCE ────────────────────────────────────────────────────────────
 *
 * `getViewer` is wrapped in React's `cache()`, which memoises per REQUEST.
 *
 * This matters more than it looks. Rendering the dashboard calls into this
 * module six times: once in the layout, three times in the navigation to decide
 * which links to show, once for the page's permission guard, and once more for
 * the finance tile. Each call runs `auth()`, and our `jwt` callback re-reads the
 * user from the database on every `auth()` — that is what makes revocation
 * immediate. Un-memoised, one page view meant SIX sequential round trips to a
 * database in Europe, which from Ghana is well over a second of pure waiting.
 *
 * With `cache()` it is ONE per request. Nothing about the security model
 * changes: the user is still re-read from the database on every request, so a
 * deactivated account is still locked out on its very next page load. We just
 * stop asking the same question six times inside a single render.
 *
 * The user's NAME also travels on the session token now, so drawing the header
 * no longer needs a query of its own.
 */

export interface Viewer {
  principal: Principal;
  name: string;
}

/**
 * The signed-in viewer, or null. Memoised for the lifetime of one request.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;

  return {
    name: session.user.name ?? '',
    principal: {
      userId: session.user.id,
      organisationId: session.user.organisationId,
      roles: session.user.roles ?? [],
      siteScope: session.user.siteScope ?? [],
    },
  };
});

/** The signed-in principal, or null. Use when absence is a valid outcome. */
export async function getPrincipal(): Promise<Principal | null> {
  return (await getViewer())?.principal ?? null;
}

/**
 * The signed-in principal, or a redirect to the login page.
 * Use at the top of any authenticated page.
 */
export async function requirePrincipal(): Promise<Principal> {
  const principal = await getPrincipal();
  if (!principal) redirect('/login');
  return principal;
}

/** Principal plus display name, or a redirect. For the application shell. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  return viewer;
}

/**
 * Require a specific permission, optionally scoped to a site.
 * Throws `AuthorizationError` — it does NOT redirect, because a permission
 * failure inside a server action is a programming or attack condition, not a
 * navigation event, and it must be loud.
 */
export async function requirePermission(
  permission: Permission,
  siteId?: string,
): Promise<Principal> {
  const principal = await requirePrincipal();
  authorize(principal, permission, siteId);
  return principal;
}

/**
 * Guard for PAGES.
 *
 * Deliberately different from `requirePermission`. A signed-in person who opens a
 * page they are not entitled to has not done anything wrong — a farm worker
 * tapping a link to the owner dashboard is an ordinary navigation mistake, and
 * it should produce a clear "you don't have access" screen, not a 500.
 *
 * Inside a SERVER ACTION the same situation means something else entirely: the
 * UI should never have offered that action, so it is either a bug or an attack.
 * That is what `requirePermission` is for, and why it throws.
 */
export async function pageGuard(
  permission: Permission,
  siteId?: string,
): Promise<{ principal: Principal; allowed: boolean }> {
  const principal = await requirePrincipal();
  return { principal, allowed: can(principal, permission, siteId) };
}

/**
 * Non-throwing check, for deciding whether to RENDER something.
 *
 * Hiding a button is a courtesy to the user, never a control. The action behind
 * the button must still call `requirePermission`.
 */
export async function currentUserCan(
  permission: Permission,
  siteId?: string,
): Promise<boolean> {
  const principal = await getPrincipal();
  return principal ? can(principal, permission, siteId) : false;
}
