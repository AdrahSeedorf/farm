import type { Principal } from '@/lib/rbac';

/**
 * Site scoping — ADRAH Farms
 *
 * A permission answers "may this person edit sites?".
 * Scoping answers "WHICH sites?". Both must be true, and they fail differently:
 * a missing permission is a 403, a scope violation is a record that simply does
 * not exist as far as that user is concerned.
 *
 * WHY SCOPING BELONGS IN THE QUERY, NOT IN A LATER `if`
 *
 *   Filtering after fetching means the row was already read, already serialised,
 *   and is one careless `console.log` or error message away from leaking. Worse,
 *   a list endpoint that forgets the post-filter silently returns everything.
 *
 *   Building the restriction into the WHERE clause makes the safe thing the
 *   default: a query written without thinking about scope returns nothing rather
 *   than everything.
 *
 * CONVENTION: an EMPTY siteScope means unrestricted (the owner). This is why the
 * helpers below are the only sanctioned way to read it — `siteScope.length === 0`
 * scattered through the codebase would eventually be typed as `.length > 0`
 * somewhere, and that inversion is silent.
 */

/** True when this principal may act across every site. */
export function hasFullSiteAccess(principal: Principal): boolean {
  return principal.siteScope.length === 0;
}

/** May this principal touch this specific site? */
export function canAccessSite(principal: Principal, siteId: string): boolean {
  return hasFullSiteAccess(principal) || principal.siteScope.includes(siteId);
}

/**
 * A Prisma `where` fragment restricting to the principal's sites.
 * Spread it into any query over a model that has a `siteId`.
 *
 *   db.animalGroup.findMany({ where: { ...siteFilter(principal), closedAt: null } })
 */
export function siteFilter(principal: Principal): { siteId?: { in: string[] } } {
  if (hasFullSiteAccess(principal)) return {};
  return { siteId: { in: principal.siteScope } };
}

/**
 * The same restriction for the `Site` model itself, where the column is `id`.
 */
export function siteIdFilter(principal: Principal): { id?: { in: string[] } } {
  if (hasFullSiteAccess(principal)) return {};
  return { id: { in: principal.siteScope } };
}

/**
 * Restriction for models reached through a site relation, e.g. ProductionUnit.
 */
export function nestedSiteFilter(principal: Principal): {
  site?: { id: { in: string[] } };
} {
  if (hasFullSiteAccess(principal)) return {};
  return { site: { id: { in: principal.siteScope } } };
}

/**
 * Organisation isolation.
 *
 * Every principal belongs to exactly one organisation. This is a second farm's
 * data being invisible to the first — a concern that only becomes real when the
 * platform runs more than one business, but which is impossible to retrofit
 * safely once queries have been written without it.
 */
export function orgFilter(principal: Principal): { organisationId: string } {
  return { organisationId: principal.organisationId };
}
