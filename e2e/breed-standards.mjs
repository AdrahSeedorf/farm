/**
 * Breed standards browser suite.
 *
 * WHAT THIS IS REALLY TESTING. The arithmetic for judging a flock against its
 * breed was already built, tested and wired into screens — and every one of
 * those screens showed a dash, because no breed had any figures in it and the
 * only way to load them was a terminal script. The weights page went as far as
 * telling a farm owner to run `npm run standards:load`.
 *
 * So the assertions that matter are about a dash BECOMING a number:
 *
 *   1. THE EMPTY STATE SAYS WHAT IT COSTS, not just that a table is missing.
 *   2. A LAY CURVE CANNOT LAND SILENTLY IN THE WEIGHT COLUMN. The detected kind
 *      is shown and agreed to every time — it is the one interpretation nothing
 *      downstream can check, because 28 grams at week 20 is a plausible number.
 *   3. PASTING A CURVE TURNS THE DASHES INTO REAL COMPARISONS, on the flock's own
 *      production screen. This is the whole point.
 *   4. SAVING ONE TABLE DOES NOT WIPE THE OTHER. One JSON column holds both.
 *   5. NO EXTRAPOLATION. Outside the published range there is still no answer.
 *   6. REMOVING A TABLE PUTS THE DASHES BACK, honestly.
 *   7. A SUPERVISOR CANNOT LOAD ONE. It is reference data for the whole farm.
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3111';
const PASSWORD = 'AdrahFarms2026';
const USERS = {
  owner: 'owner@adrahfarms.com',
  supervisor: 'supervisor@adrahfarms.com',
};

let pass = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✕ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * ON_ERROR_STOP, unlike the other suites.
 *
 * The first version of this fixture left `ageDays` off the ProductionRecord
 * insert. psql carried on, the statement was skipped, and the suite reported
 * "Nothing recorded yet" as though the screen were wrong. A fixture that
 * silently skips a statement is the same bug class this whole suite exists to
 * catch, so here it stops.
 */
const sql = (body) =>
  execSync(`su postgres -c 'psql -h /tmp -p 5433 -d adrah -q -t -A -v ON_ERROR_STOP=1' <<'SQL'\n${body}\nSQL`, {
    stdio: 'pipe',
    shell: '/bin/bash',
  })
    .toString()
    .trim();

// --- the fixture ------------------------------------------------------------
//
// Every breed starts with NO standards, which is the real state of the system
// and the first thing this suite checks. A laying-age flock on ISA Brown, with
// production recorded, so there is something for a curve to be compared against.
sql(`
UPDATE "Breed" SET standards = NULL;

WITH ctx AS (
  SELECT
    (SELECT id FROM "Site" ORDER BY "createdAt" LIMIT 1)                  AS site_id,
    (SELECT id FROM "ProductionUnit" WHERE name = 'House A' LIMIT 1)      AS unit_id,
    (SELECT id FROM "SpeciesProfile" ORDER BY "createdAt" LIMIT 1)        AS species_id,
    (SELECT id FROM "ProductionTypeProfile" ORDER BY "createdAt" LIMIT 1) AS ptype_id,
    (SELECT id FROM "LifecycleStage" WHERE key = 'laying' LIMIT 1)        AS stage_id,
    (SELECT id FROM "Breed" WHERE name = 'ISA Brown' LIMIT 1)             AS breed_id
)
INSERT INTO "AnimalGroup"
  (id, "siteId", "productionUnitId", "speciesProfileId", "productionTypeProfileId",
   code, "dateOfHatch", "arrivalDate", "currentStageId", "breedId", "updatedAt")
SELECT 'flk-std-1', site_id, unit_id, species_id, ptype_id, 'FLK-STD-1',
       CURRENT_DATE - 210, CURRENT_DATE - 209, stage_id, breed_id, now()
FROM ctx
ON CONFLICT (id) DO UPDATE
  SET "dateOfHatch" = EXCLUDED."dateOfHatch",
      "breedId"     = EXCLUDED."breedId",
      "closedAt"    = NULL;

DELETE FROM "AnimalGroupEvent" WHERE "animalGroupId" = 'flk-std-1';
INSERT INTO "AnimalGroupEvent"
  (id, "animalGroupId", type, delta, "occurredOn", "ageDays", "recordedById")
SELECT 'age-std-place', 'flk-std-1', 'PLACEMENT', 1000, CURRENT_DATE - 209, 1,
       (SELECT id FROM "User" WHERE email = 'owner@adrahfarms.com');

-- Seven days of collections at roughly 90% hen-day, so the "vs standard" column
-- has an actual figure to subtract a standard from.
DELETE FROM "ProductionRecord" WHERE "animalGroupId" = 'flk-std-1';
INSERT INTO "ProductionRecord"
  (id, "animalGroupId", "onDate", sequence, "ageDays", "countedBase",
   "idempotencyKey", "recordedById")
SELECT 'prod-std-' || g, 'flk-std-1', CURRENT_DATE - g, 1, 210 - g, 900,
       'e2e-std-' || g,
       (SELECT id FROM "User" WHERE email = 'owner@adrahfarms.com')
FROM generate_series(1, 7) AS g;
`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => failures.push(`Uncaught page error: ${e.message}`));
const text = () => page.evaluate(() => document.querySelector('main')?.innerText ?? '');

async function open(path, marker = 'main') {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.locator(marker).first().waitFor({ timeout: 20000 });
}

async function signIn(email) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login?method=email`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').waitFor({ timeout: 20000 });
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  // SCOPED to the form. A bare button[type=submit] matches the navigation's
  // sign-out form, and the suite signs itself out — which is indistinguishable
  // from a permission failure.
  await page.click('main form button[type=submit]:has-text("Sign in")');
  await page.waitForURL(/dashboard|daily|flocks|production|health|alerts|settings/, {
    timeout: 15000,
  });
}

/** Wait for a heading unique to the DESTINATION — `main h1` resolves instantly. */
const waitForHeading = (fragment) =>
  page.locator(`main h1:has-text("${fragment}")`).first().waitFor({ timeout: 20000 });

const isaBrownId = sql(`SELECT id FROM "Breed" WHERE name = 'ISA Brown' LIMIT 1;`);
const standardsJson = () =>
  sql(`SELECT COALESCE(standards::text, 'null') FROM "Breed" WHERE id = '${isaBrownId}';`);

// Two columns out of a management guide, header and all.
const LAY_CURVE = [
  'week,henDayPct',
  '20,28.5',
  '22,78.0',
  '25,92.0',
  '30,94.0',
  '35,92.5',
  '40,89.0',
].join('\n');

const WEIGHT_TABLE = ['week,grams', '1,70', '6,480', '12,1050', '18,1520', '30,1900'].join('\n');

let body;

// ---------------------------------------------------------------------------
console.log('\nNothing loaded, and the screens say what that costs');
await signIn(USERS.owner);
await open('/settings/breeds');
body = await text();
check('the screen exists at all', /Breed standards/.test(body));
check(
  'and says nothing here is invented',
  /nothing here is invented/i.test(body),
  body.slice(0, 500),
);
check(
  'it warns that breeds IN USE are missing tables',
  /missing a table/i.test(body),
  body.slice(0, 900),
);
check('ISA Brown reads none for both tables', /ISA Brown/.test(body) && /none/.test(body));

await open(`/settings/breeds/${isaBrownId}`);
await waitForHeading('ISA Brown');
body = await text();
check(
  'the breed page says what is NOT being compared, not just what is missing',
  /reads a dash on every row/i.test(body),
  body.slice(0, 1200),
);
check(
  'and says the same for weight, naming the decision it feeds',
  /whether to add light at week 15/i.test(body),
);
check(
  'it says how many flocks are affected',
  /flock is on this breed|flocks are on this breed/i.test(body),
);

// ---------------------------------------------------------------------------
console.log('\nThe flock production screen is showing dashes');
// Straight to the screen. Clicking through two pages to reach it tests the
// navigation, not the comparison, and breaks when a link is relabelled.
await open('/flocks/flk-std-1/production');
await page.waitForTimeout(1200);
body = await text();
check(
  'the vs-standard column is there and empty',
  /vs standard/i.test(body),
  body.slice(0, 600),
);
check(
  'and it says why, naming the breed',
  /No lay curve has been loaded for ISA Brown/i.test(body),
  body.slice(0, 2500),
);

// ---------------------------------------------------------------------------
console.log('\nA lay curve cannot land silently in the weight column');
await open(`/settings/breeds/${isaBrownId}`);
await waitForHeading('ISA Brown');
await page.fill('#table', LAY_CURVE);
await page.fill('#sourceNote', 'ISA Brown Commercial Management Guide, 2024, p.22');
await page.click('main form button[type=submit]:has-text("Read the table")');
await page.waitForTimeout(1800);
body = await text();
check(
  'the kind it was read as is SAID OUT LOUD before anything is written',
  /Read as a lay curve/i.test(body),
  body.slice(0, 1200),
);
check('with the span, in days and weeks and the right unit', /day 140 \(week 20\) → 28.5%/.test(body));
check('it names the breed it will be saved against', /saved against ISA Brown/i.test(body));
check(
  'and warns what a wrong kind would do',
  /look plausible and are nonsense/i.test(body),
);
check('nothing has been saved yet', standardsJson() === 'null', standardsJson().slice(0, 80));
check('and it says so', /Nothing has been saved yet/i.test(body));
check('the pasted table is still in the box', (await page.inputValue('#table')).includes('28.5'));

await page.click('main form button[type=submit]:has-text("Yes, save it")');
await page.waitForTimeout(2000);
body = await text();
check('confirming saves it', /6 points saved as ISA Brown's lay curve/i.test(body), body.slice(0, 500));
check(
  'the figures are keyed by age in DAYS, not weeks',
  standardsJson().includes('"140"') && standardsJson().includes('"210"'),
  standardsJson().slice(0, 200),
);
check(
  'and where it came from is kept beside them',
  standardsJson().includes('2024, p.22'),
);

// ---------------------------------------------------------------------------
console.log('\nTHE DASHES BECOME REAL COMPARISONS');
// Straight to the screen. Clicking through two pages to reach it tests the
// navigation, not the comparison, and breaks when a link is relabelled.
await open('/flocks/flk-std-1/production');
await page.waitForTimeout(1200);
body = await text();
check(
  'the "no lay curve loaded" notice is gone',
  !/No lay curve has been loaded/i.test(body),
  body.slice(0, 2500),
);
check(
  'and the column now carries a signed figure in points',
  /[+-]\d+(\.\d)? ?(points|pts)?/.test(body) && /vs standard/i.test(body),
  body.slice(0, 2500),
);

// ---------------------------------------------------------------------------
console.log('\nSaving one table does not wipe the other');
await open(`/settings/breeds/${isaBrownId}`);
await waitForHeading('ISA Brown');
await page.fill('#table', WEIGHT_TABLE);
await page.click('main form button[type=submit]:has-text("Read the table")');
await page.waitForTimeout(1800);
check('this one is read as a body weight table', /Read as a body weight table/i.test(await text()));
await page.click('main form button[type=submit]:has-text("Yes, save it")');
await page.waitForTimeout(2000);
check(
  'BOTH tables are now on the breed',
  standardsJson().includes('henDayPctByAgeDays') &&
    standardsJson().includes('bodyWeightByAgeDays'),
  standardsJson().slice(0, 200),
);
body = await text();
check('and the page shows both as loaded', !/Not loaded/i.test(body), body.slice(0, 1200));

// ---------------------------------------------------------------------------
console.log('\nNo extrapolation past what the guide printed');
body = await text();
check(
  'the published range is stated',
  /day 140–280/.test(body) || /day 7–210/.test(body),
  body.slice(0, 1400),
);
check(
  'and it says plainly that nothing outside it is compared',
  /is not extrapolated past what the guide printed/i.test(body),
);

// ---------------------------------------------------------------------------
console.log('\nA table that does not say what it is gets refused');
await page.fill('#table', 'week,value\n20,28.5\n30,94.0');
await page.click('main form button[type=submit]:has-text("Read the table")');
await page.waitForTimeout(1800);
body = await text();
check(
  'it refuses rather than guessing',
  /does not say which kind of table it is/i.test(body),
  body.slice(0, 900),
);
check(
  'and says exactly how to fix it',
  /grams/.test(body) && /henDayPct/.test(body),
);

// ---------------------------------------------------------------------------
console.log('\nRemoving a table puts the dashes back, honestly');
await open(`/settings/breeds/${isaBrownId}`);
await waitForHeading('ISA Brown');
await page.click('main form button[type=submit]:has-text("Remove the lay curve")');
await page.waitForTimeout(2000);
check(
  'the lay curve is gone and the weight table is untouched',
  !standardsJson().includes('henDayPctByAgeDays') &&
    standardsJson().includes('bodyWeightByAgeDays'),
  standardsJson().slice(0, 200),
);
// NOT a toast. A successful removal makes the form that would hold one
// disappear, so the page's empty state carries the consequence instead — which
// is the more useful sentence anyway.
body = await text();
check(
  'the lay curve now reads Not loaded',
  /Lay curve[\s\S]{0,120}Not loaded/i.test(body),
  body.slice(0, 1200),
);
check(
  'and the page says what that means rather than just that it is missing',
  /reads a dash on every row/i.test(body),
  body.slice(0, 1400),
);
check(
  'while the body weight table is still reported as loaded',
  /Body weight[\s\S]{0,120}\d+ points/i.test(body),
  body.slice(0, 1200),
);

// ---------------------------------------------------------------------------
console.log('\nWho may load a standard');
await signIn(USERS.supervisor);
await open('/settings/breeds');
body = await text();
check('a supervisor cannot reach it — it is farm-wide reference data', /access/i.test(body), body.slice(0, 300));

await browser.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✕ ${f}`);
  process.exit(1);
}
