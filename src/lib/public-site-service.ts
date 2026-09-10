import 'server-only';
import { db } from '@/lib/db';
import {
  supplyStateOf,
  publicContact,
  type SupplyState,
  type PublicContact,
} from '@/lib/public-site';

/**
 * What the public site is allowed to say — read from the farm.
 *
 * NO PRINCIPAL, AND NO SITE SCOPE. This is the one service in the codebase that
 * runs for somebody who is not signed in, so it takes no `Principal` and every
 * query here is written by hand rather than reusing an office query with the
 * scope helpers left off by accident.
 *
 * WHAT IT IS ALLOWED TO READ IS DELIBERATELY TINY: how many flocks exist, how
 * much was collected recently, and the earliest expected point of lay. Counts
 * and one date. No flock codes, no house names, no prices, no supplier, nothing
 * that identifies a person. A public page cannot leak what it was never handed.
 */

/** How far back "recently producing" looks. */
const RECENT_DAYS = 14;

export interface SiteFacts {
  state: SupplyState;
  expectedFirstLay: Date | null;
  contact: PublicContact;
}

/**
 * Read `pointOfLayAgeDays` out of a production type's standards blob.
 *
 * The same figure the production screens use. Null where nobody has stated one,
 * and null is a real answer — the site then says "our first flock is in
 * rearing" without inventing a month.
 */
function pointOfLayAgeFrom(standards: unknown): number | null {
  if (typeof standards !== 'object' || standards === null) return null;
  const value = (standards as Record<string, unknown>).pointOfLayAgeDays;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export async function siteFacts(asOf: Date = new Date()): Promise<SiteFacts> {
  const since = new Date(asOf.getTime() - RECENT_DAYS * 86_400_000);

  const [flocks, recent] = await Promise.all([
    db.animalGroup.findMany({
      where: { closedAt: null },
      select: {
        dateOfHatch: true,
        productionType: { select: { standards: true } },
      },
    }),
    db.productionRecord.count({ where: { onDate: { gte: since } } }),
  ]);

  // The EARLIEST date any placed flock is expected to lay — the farm can supply
  // from whenever its first flock starts, not its last.
  let expectedFirstLay: Date | null = null;
  for (const flock of flocks) {
    const polAge = pointOfLayAgeFrom(flock.productionType.standards);
    if (polAge === null) continue;
    const expected = new Date(flock.dateOfHatch.getTime() + polAge * 86_400_000);
    if (expectedFirstLay === null || expected < expectedFirstLay) expectedFirstLay = expected;
  }

  return {
    state: supplyStateOf({
      flocks: flocks.length,
      recentProduction: recent,
      expectedFirstLay,
    }),
    expectedFirstLay,
    contact: publicContact(),
  };
}
