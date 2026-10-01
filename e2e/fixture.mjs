/**
 * Shared fixture for the browser suites.
 *
 * WHY THIS IS IN THE REPOSITORY AND IN SQL.
 *
 * The suites used to depend on a fixture script that lived on one machine. When
 * that machine was reclaimed the fixture went with it and every suite that
 * needed a flock stopped working. So this lives here, next to the suites that
 * use it, and it is plain SQL run through psql — no Prisma client, no tsx, no
 * build step, nothing that can be stale.
 *
 * IT BUILDS ONLY WHAT THE SEED DOES NOT. `npm run db:seed` creates the
 * organisation, the site, two houses, the species and the lifecycle stages. What
 * it deliberately does not create is a flock, because a real farm places its own
 * birds. The suites need one, so this places it.
 *
 * Everything here is idempotent. Running it twice leaves one flock.
 */
import { execSync } from 'node:child_process';

export const sql = (body) =>
  execSync(`su postgres -c 'psql -h /tmp -p 5433 -d adrah -q -t -A' <<'SQL'\n${body}\nSQL`, {
    stdio: 'pipe',
    shell: '/bin/bash',
  })
    .toString()
    .trim();

export const FLOCK_CODE = 'FLK-E2E-1';
export const HOUSE_NAME = 'House A';

/**
 * A flock in House A, old enough to be laying, with its birds on the ledger.
 *
 * 200 days old: past point of lay for a layer, so the production and withdrawal
 * paths are all reachable. The placement is a real AnimalGroupEvent, because the
 * bird count is derived from that ledger and a flock with no placement row has
 * no birds — which has caught a suite before.
 */
export function ensureFlock({ birds = 1000, ageDays = 200 } = {}) {
  sql(`
WITH ctx AS (
  SELECT
    (SELECT id FROM "Site" ORDER BY "createdAt" LIMIT 1)                              AS site_id,
    (SELECT id FROM "ProductionUnit" WHERE name = '${HOUSE_NAME}' LIMIT 1)            AS unit_id,
    (SELECT id FROM "SpeciesProfile" ORDER BY "createdAt" LIMIT 1)                    AS species_id,
    (SELECT id FROM "ProductionTypeProfile" ORDER BY "createdAt" LIMIT 1)             AS ptype_id,
    (SELECT id FROM "LifecycleStage" WHERE key = 'laying' LIMIT 1)                    AS stage_id,
    (SELECT id FROM "User" WHERE email = 'owner@adrahfarms.com' LIMIT 1)              AS user_id
)
INSERT INTO "AnimalGroup"
  (id, "siteId", "productionUnitId", "speciesProfileId", "productionTypeProfileId",
   code, "dateOfHatch", "arrivalDate", "currentStageId", "updatedAt")
SELECT
  'flk-e2e-1', site_id, unit_id, species_id, ptype_id,
  '${FLOCK_CODE}',
  CURRENT_DATE - ${ageDays},
  CURRENT_DATE - ${ageDays - 1},
  stage_id,
  now()
FROM ctx
ON CONFLICT (id) DO UPDATE SET "currentStageId" = EXCLUDED."currentStageId";

DELETE FROM "AnimalGroupEvent" WHERE "animalGroupId" = 'flk-e2e-1';

INSERT INTO "AnimalGroupEvent"
  (id, "animalGroupId", type, delta, "occurredOn", "ageDays", "recordedById")
SELECT 'age-e2e-place', 'flk-e2e-1', 'PLACEMENT', ${birds},
       CURRENT_DATE - ${ageDays - 1}, 1,
       (SELECT id FROM "User" WHERE email = 'owner@adrahfarms.com' LIMIT 1);
  `);

  return sql(`SELECT id FROM "AnimalGroup" WHERE code = '${FLOCK_CODE}';`);
}

/** Everything a sales-side suite writes, in foreign-key order. */
export function clearSales() {
  sql(`
DELETE FROM "Payment";
DELETE FROM "DispatchLine";
DELETE FROM "Dispatch";
DELETE FROM "SalesOrderLine";
DELETE FROM "SalesOrder";
DELETE FROM "ProductPrice";
DELETE FROM "Product";
DELETE FROM "Customer";
  `);
}
