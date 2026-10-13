import 'server-only';
import { db } from '@/lib/db';
import { permissionsFor, type Principal } from '@/lib/rbac';
import { buildNav, wordsFor, type NavGroup } from '@/lib/navigation';

/**
 * The navigation, for one person, on one farm.
 *
 * ONE QUERY AND ONE PERMISSION PASS. The old component asked `currentUserCan`
 * twenty-six times per render — once per link, including the four duplicates —
 * and each of those re-read the session. The permissions are now taken off the
 * principal in a single set and handed to a pure function.
 *
 * The species query is the only database work, and it reads at most two rows.
 */
export async function navigationFor(principal: Principal): Promise<NavGroup[]> {
  const profiles = await db.speciesProfile.findMany({
    where: { organisationId: principal.organisationId, isActive: true },
    select: { terminology: true },
    // TWO, NOT ALL. The question is "is there exactly one?", and a farm with
    // nine species should not pull nine rows to answer it.
    take: 2,
  });

  return buildNav(wordsFor(profiles.map((p) => p.terminology)), permissionsFor(principal));
}
