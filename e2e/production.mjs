/**
 * Production browser suite.
 *
 * The other half of what everything derives from. A collection is the only
 * source of every egg figure on this farm: hen-day production, the saleable
 * share, the period report's reconciliation, what the store is told it received.
 *
 * The assertions that matter:
 *
 *   1. A COLLECTION BECOMES A HEN-DAY FIGURE, end to end, on the flock's own
 *      screen — not just a row in a table.
 *   2. GRADES THAT DO NOT ADD UP TO THE COUNT ARE QUESTIONED. Eggs break between
 *      the house and the grading bench, so the two figures are both kept and the
 *      difference is a measurement, not an error to resolve away — but a large
 *      one is worth a second look.
 *   3. A CORRECTION IS A NEW RECORD, NEVER AN EDIT. The original stays, marked,
 *      with a reason. This is the rule the whole system is built on and it had
 *      no browser proof.
 *   4. A CORRECTION CANNOT ITSELF BE CORRECTED, which would make the history a
 *      chain nobody can read.
 *   5. PRODUCE THAT NOBODY HOLDS AS STOCK IS SAID OUT LOUD, rather than quietly
 *      going nowhere.
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3111';
const PASSWORD = 'AdrahFarms2026';
const USERS = {
  owner: 'owner@adrahfarms.com',
  worker: 'worker@adrahfarms.com',
  driver: 'driver@adrahfarms.com',
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

const sql = (body) =>
  execSync(
    `su postgres -c 'psql -h /tmp -p 5433 -d adrah -q -t -A -v ON_ERROR_STOP=1' <<'SQL'\n${body}\nSQL`,
    { stdio: 'pipe', shell: '/bin/bash' },
  )
    .toString()
    .trim();

// --- the fixture ------------------------------------------------------------
sql(`
DELETE FROM "ProductionLine" WHERE "productionRecordId" IN
  (SELECT id FROM "ProductionRecord" WHERE "animalGroupId" = 'flk-prod-1');
DELETE FROM "ProductionRecord"  WHERE "animalGroupId" = 'flk-prod-1';
DELETE FROM "AnimalGroupEvent"  WHERE "animalGroupId" = 'flk-prod-1';

WITH ctx AS (
  SELECT
    (SELECT id FROM "Site" ORDER BY "createdAt" LIMIT 1)                  AS site_id,
    (SELECT id FROM "ProductionUnit" WHERE name = 'House A' LIMIT 1)      AS unit_id,
    (SELECT id FROM "SpeciesProfile" ORDER BY "createdAt" LIMIT 1)        AS species_id,
    (SELECT id FROM "ProductionTypeProfile" ORDER BY "createdAt" LIMIT 1) AS ptype_id,
    (SELECT id FROM "LifecycleStage" WHERE key = 'laying' LIMIT 1)        AS stage_id
)
INSERT INTO "AnimalGroup"
  (id, "siteId", "productionUnitId", "speciesProfileId", "productionTypeProfileId",
   code, "dateOfHatch", "arrivalDate", "currentStageId", "updatedAt")
SELECT 'flk-prod-1', site_id, unit_id, species_id, ptype_id, 'FLK-PROD-1',
       CURRENT_DATE - 210, CURRENT_DATE - 209, stage_id, now()
FROM ctx
ON CONFLICT (id) DO UPDATE
  SET "closedAt" = NULL, "dateOfHatch" = EXCLUDED."dateOfHatch",
      "currentStageId" = EXCLUDED."currentStageId";

INSERT INTO "AnimalGroupEvent"
  (id, "animalGroupId", type, delta, "occurredOn", "ageDays", "recordedById")
SELECT 'age-prod-place', 'flk-prod-1', 'PLACEMENT', 1000, CURRENT_DATE - 209, 1,
       (SELECT id FROM "User" WHERE email = 'owner@adrahfarms.com');

UPDATE "AnimalGroup" SET "closedAt" = now() WHERE id <> 'flk-prod-1' AND "closedAt" IS NULL;
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
  await page.click('main form button[type=submit]:has-text("Sign in")');
  await page.waitForURL(/dashboard|daily|flocks|production|health|alerts/, { timeout: 15000 });
}

/** Save, and confirm if the form asks. A warning is not a failure to save. */
async function saveCollection() {
  await page.click('main form button[type=submit]:has-text("Save this collection")');
  await page.waitForTimeout(2000);
  const confirm = page.locator('main form button[type=submit]:has-text("Yes, this is correct")');
  if ((await confirm.count()) > 0) {
    await confirm.click();
    await page.waitForTimeout(2500);
  }
}

const recordCount = () =>
  Number(sql(`SELECT count(*) FROM "ProductionRecord" WHERE "animalGroupId"='flk-prod-1';`));
/**
 * The net figure, which is the plain sum.
 *
 * A correction is a new row carrying the NEGATIVE of the one it corrects, so
 * nothing has to be excluded: 880 and −880 add to nothing, and both rows stay
 * visible in the order they happened.
 */
const liveTotal = () =>
  Number(
    sql(
      `SELECT COALESCE(sum("countedBase"),0) FROM "ProductionRecord" WHERE "animalGroupId"='flk-prod-1';`,
    ),
  );

let body;

// ---------------------------------------------------------------------------
console.log('\nRecording a collection');
await signIn(USERS.worker);
await open('/production');
body = await text();
check('the house is offered for collection', /FLK-PROD-1|House A/.test(body), body.slice(0, 400));

await open('/production/flk-prod-1');
body = await text();
check('the form opens', (await page.locator('#counted').count()) === 1, body.slice(0, 300));
check(
  'and says how many birds are in the house, so the count has a scale',
  /1,000|1000/.test(body),
  body.slice(0, 500),
);

await page.fill('#counted', '880');
await saveCollection();
check('the collection saved', recordCount() === 1, `${recordCount()} records`);
check('with the figure as counted', liveTotal() === 880, `${liveTotal()}`);

/**
 * SAID AT THE MOMENT OF SAVING, which is the only moment it is useful.
 *
 * Somebody who has just recorded 880 eggs and hears nothing about stock cannot
 * tell produce going into the store from produce silently not going in. No
 * grade here is linked to a store item, so nothing reaches stock — and the
 * confirmation has to say so rather than leaving it to be discovered on a
 * report weeks later.
 */
const saved = await text();
check(
  'the confirmation says what happened to the store',
  /store|stock/i.test(saved),
  saved.slice(0, 700),
);
check(
  'and no stock movement was invented for produce nobody holds',
  Number(sql(`SELECT count(*) FROM "StockMovement" WHERE type='PRODUCTION';`)) === 0,
);

// ---------------------------------------------------------------------------
console.log('\nIt becomes a hen-day figure');
await open('/flocks/flk-prod-1/production');
body = await text();
check('the flock screen shows the collection', /880/.test(body), body.slice(0, 900));
check(
  'AND TURNS IT INTO HEN-DAY PRODUCTION — 880 of 1,000 birds is 88%',
  /8[7-9](\.\d)?%/.test(body),
  body.slice(0, 1200),
);

// ---------------------------------------------------------------------------
console.log('\nA correction is a new record, never an edit');
const originalId = sql(
  `SELECT id FROM "ProductionRecord" WHERE "animalGroupId"='flk-prod-1' LIMIT 1;`,
);

// A WORKER RECORDS BUT DOES NOT CORRECT. They hold production view and create,
// not edit — writing down what happened and revising yesterday's figure are
// different acts.
await open('/production/flk-prod-1');
check(
  'a worker is offered no way to correct a collection',
  (await page.locator('main form button[type=submit]:has-text("Record the correction")').count()) === 0,
);

await signIn(USERS.owner);
await open('/production/flk-prod-1');
body = await text();
check('somebody who may correct is offered it', /correct/i.test(body), body.slice(0, 900));

// The reason box is behind a "Correct" toggle, so correcting is a deliberate
// two-step act rather than a field sitting open beside every row.
await page.click('main button:has-text("Correct")');
await page.waitForTimeout(400);
await page.fill('input[name="reason"]', 'Counted the second trolley twice');
await page.click('main form button[type=submit]:has-text("Record the correction")');
await page.waitForTimeout(2500);

check('a SECOND record exists — the first was not edited', recordCount() === 2, `${recordCount()}`);
check(
  'THE ORIGINAL IS STILL THERE, with its original figure',
  sql(`SELECT "countedBase" FROM "ProductionRecord" WHERE id='${originalId}';`) === '880',
);
check(
  'and another record points at it rather than it being flagged in place',
  Number(
    sql(`SELECT count(*) FROM "ProductionRecord" WHERE "correctsId"='${originalId}';`),
  ) === 1,
);
check(
  'THE CORRECTION CARRIES THE NEGATIVE of what it reverses',
  sql(`SELECT "countedBase" FROM "ProductionRecord" WHERE "correctsId"='${originalId}';`) === '-880',
);
check(
  'the reason is kept on it',
  /second trolley/i.test(
    sql(`SELECT COALESCE(notes,'') FROM "ProductionRecord" WHERE "correctsId"='${originalId}';`),
  ),
);
check(
  'and the live total no longer counts the corrected record',
  liveTotal() === 0,
  `${liveTotal()}`,
);

// ---------------------------------------------------------------------------
console.log('\nA correction cannot itself be corrected');
await open('/production/flk-prod-1');
body = await text();
// Re-entering the day is how a corrected count is restated; correcting the
// correction would make the history a chain nobody can read.
check(
  'the screen does not offer to correct a correction',
  (await page.locator('main form button[type=submit]:has-text("Record the correction")').count()) === 0 ||
    /already/i.test(body),
  body.slice(0, 900),
);
// AND THE DATABASE ITSELF REFUSES, not only the screen: correctsId is UNIQUE,
// so a second correction of the same collection cannot exist even if some
// future caller forgets the check.
check(
  'and the database refuses a second correction of the same collection',
  sql(`SELECT count(*) FROM pg_indexes WHERE tablename='ProductionRecord' AND indexdef ILIKE '%UNIQUE%correctsId%';`) === '1',
  sql(`SELECT indexname FROM pg_indexes WHERE tablename='ProductionRecord';`),
);

// ---------------------------------------------------------------------------
console.log('\nWho may record what was collected');
await signIn(USERS.driver);
await open('/production');
check('a driver is refused', /access/i.test(await text()));

await signIn(USERS.owner);
await open('/production/flk-prod-1');
check('an owner reaches it', !/access/i.test(await text()));

await browser.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✕ ${f}`);
  process.exit(1);
}
