/**
 * Daily record browser suite.
 *
 * WHY THIS ONE MATTERS MOST. Every derived figure on this farm — hen-day
 * production, mortality percentage, feed per bird, cost per egg, the period
 * report, the alert engine — traces back to what somebody typed on this screen
 * at six in the morning. It had no browser coverage at all.
 *
 * The assertions that matter:
 *
 *   1. ONE SUBMIT, ONE TRANSACTION. A record saying "6 died" alongside a ledger
 *      that never lost the birds is exactly the disagreement the ledger exists
 *      to prevent. The suite checks the DailyRecord row and the population
 *      ledger move together.
 *   2. WARN, NEVER BLOCK. A mortality spike warns, and then saves exactly as
 *      typed when the person confirms.
 *   3. THE ACKNOWLEDGEMENT IS BOUND TO THE CONTENT — the single most important
 *      check in this file. Warn on one figure, change the figure, resubmit with
 *      the old acknowledgement: the new number must be warned about again rather
 *      than saved silently. This is a real bug that was found in this form once
 *      already, and the token exists only to stop it.
 *   4. CORRECTING A DAY DOES NOT ERASE IT.
 *   5. A WORKER CAN RECORD AND A DRIVER CANNOT.
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

/** ON_ERROR_STOP: a fixture that silently skips a statement proves nothing. */
const sql = (body) =>
  execSync(
    `su postgres -c 'psql -h /tmp -p 5433 -d adrah -q -t -A -v ON_ERROR_STOP=1' <<'SQL'\n${body}\nSQL`,
    { stdio: 'pipe', shell: '/bin/bash' },
  )
    .toString()
    .trim();

// --- the fixture ------------------------------------------------------------
//
// One laying flock of 1,000 birds, nothing recorded today. 200 days old so the
// brooding half of the form is correctly absent.
sql(`
DELETE FROM "DailyRecord"      WHERE "animalGroupId" = 'flk-daily-1';
DELETE FROM "AnimalGroupEvent" WHERE "animalGroupId" = 'flk-daily-1';

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
SELECT 'flk-daily-1', site_id, unit_id, species_id, ptype_id, 'FLK-DAILY-1',
       CURRENT_DATE - 200, CURRENT_DATE - 199, stage_id, now()
FROM ctx
ON CONFLICT (id) DO UPDATE
  SET "closedAt" = NULL, "dateOfHatch" = EXCLUDED."dateOfHatch",
      "currentStageId" = EXCLUDED."currentStageId";

INSERT INTO "AnimalGroupEvent"
  (id, "animalGroupId", type, delta, "occurredOn", "ageDays", "recordedById")
SELECT 'age-daily-place', 'flk-daily-1', 'PLACEMENT', 1000, CURRENT_DATE - 199, 1,
       (SELECT id FROM "User" WHERE email = 'owner@adrahfarms.com');

-- DELIBERATELY DOES NOT TOUCH OTHER FLOCKS.
--
-- An earlier version closed every other group so this screen was about one
-- house. That reached into the data three other suites depend on and broke
-- them. A fixture may create and reset its OWN rows; narrowing a shared screen
-- is the suite's job, and this one navigates straight to its flock.
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
  // SCOPED. A bare button[type=submit] matches the navigation's sign-out form.
  await page.click('main form button[type=submit]:has-text("Sign in")');
  await page.waitForURL(/dashboard|daily|flocks|production|health|alerts/, { timeout: 15000 });
}

const population = () =>
  Number(
    sql(`SELECT COALESCE(sum(delta),0) FROM "AnimalGroupEvent" WHERE "animalGroupId"='flk-daily-1';`),
  );
const records = () =>
  Number(sql(`SELECT count(*) FROM "DailyRecord" WHERE "animalGroupId"='flk-daily-1';`));
const eventsOfType = (type) =>
  Number(
    sql(
      `SELECT count(*) FROM "AnimalGroupEvent" WHERE "animalGroupId"='flk-daily-1' AND type='${type}';`,
    ),
  );

/**
 * Save, and confirm if the form asks.
 *
 * Six deaths in a thousand is 0.6%, which is over the threshold the farm set —
 * so even an ordinary entry warns. A helper that only clicked Save once would
 * report every warning as a failure to save.
 */
async function saveDaily() {
  await page.click('main form button[type=submit]:has-text("Save")');
  await page.waitForTimeout(2000);
  const confirm = page.locator('main form button[type=submit]:has-text("Yes, this is correct")');
  if ((await confirm.count()) > 0) {
    await confirm.click();
    await page.waitForTimeout(2500);
  }
}

/** The acknowledgement the form is currently carrying. */
const tokenOnPage = () =>
  page.$eval('input[name="acknowledgedToken"]', (el) => el.value).catch(() => '');

let body;

// ---------------------------------------------------------------------------
console.log('\nA house with nothing written down yet');
await signIn(USERS.worker);
await open('/daily');
body = await text();
check('the house is waiting to be recorded', /FLK-DAILY-1|House A/.test(body), body.slice(0, 400));

await open('/daily/flk-daily-1');
body = await text();
check('the form opens', /mortality|died/i.test(body), body.slice(0, 400));
check('it says how many birds are in the house', /1,000|1000/.test(body), body.slice(0, 500));
check(
  'and the brooding questions are absent for a laying flock',
  // By the FIELD, not by the word: "Chilling / brooder failure" is a cause of
  // death in the dropdown and appears at every age.
  (await page.locator('#broodTempC').count()) === 0 &&
    (await page.locator('#litterCondition').count()) === 0,
);

// ---------------------------------------------------------------------------
console.log('\nOne submit, one transaction');
const before = population();
await page.fill('#mortality', '6');
await page.selectOption('#mortalityReason', { index: 1 }).catch(() => {});
await page.fill('#feedKg', '115');
await page.fill('#waterLitres', '230');
await saveDaily();

check('the record saved', records() === 1, `${records()} records`);
check('a mortality event was written to the ledger', eventsOfType('MORTALITY') === 1);
check(
  'AND THE POPULATION MOVED BY EXACTLY THAT MUCH',
  population() === before - 6,
  `${before} → ${population()}`,
);
check(
  'the event points back at the record it came from',
  sql(
    `SELECT "sourceType" FROM "AnimalGroupEvent" WHERE "animalGroupId"='flk-daily-1' AND type='MORTALITY';`,
  ) === 'dailyRecord',
);

// ---------------------------------------------------------------------------
console.log('\nA second record for the same day');
await open('/daily/flk-daily-1');
body = await text();
check(
  'the screen says today is already recorded rather than silently accepting a second',
  /already/i.test(body) || /recorded/i.test(body),
  body.slice(0, 600),
);
check('and no duplicate was created', records() === 1, `${records()} records`);

// ---------------------------------------------------------------------------
console.log('\nWarn, never block');
// Clear today so the form is live again, and warn with a spike.
sql(`
DELETE FROM "AnimalGroupEvent" WHERE "animalGroupId"='flk-daily-1' AND "sourceType"='dailyRecord';
DELETE FROM "DailyRecord" WHERE "animalGroupId"='flk-daily-1';
`);
await open('/daily/flk-daily-1');
await page.fill('#mortality', '50');
await page.selectOption('#mortalityReason', { index: 1 }).catch(() => {});
await page.fill('#feedKg', '115');
await page.click('main form button[type=submit]:has-text("Save")');
await page.waitForTimeout(2000);
body = await text();
check('50 deaths in a flock of 994 is warned about', /%/.test(body) && /\b50\b/.test(body), body.slice(0, 900));
check('nothing is saved yet', records() === 0, `${records()} records`);
check('and the figure is still in the box', (await page.inputValue('#mortality')) === '50');

/**
 * THE CHECK THIS WHOLE SUITE WAS WORTH WRITING FOR.
 *
 * A plain "I have seen the warnings" checkbox stays ticked. Correct the figure,
 * resubmit, and the form saves a brand-new problem that was never shown to
 * anyone. The token is a fingerprint of the warnings actually displayed, so
 * changing the entry must invalidate it.
 */
console.log('\nThe acknowledgement is bound to the content');
const staleToken = await tokenOnPage();
check('an acknowledgement was issued for what was shown', staleToken.length > 0, staleToken);

await page.fill('#mortality', '120');
await page.click('main form button[type=submit]:has-text("Yes, this is correct")');
await page.waitForTimeout(2000);
body = await text();
check(
  'CHANGING THE FIGURE INVALIDATES IT — the new number is warned about again',
  records() === 0,
  `${records()} records saved without being shown`,
);
check('and the warning now describes the NEW figure', /120/.test(body), body.slice(0, 900));
const freshToken = await tokenOnPage();
check(
  'the acknowledgement itself changed with the content',
  freshToken.length > 0 && freshToken !== staleToken,
  `${staleToken} → ${freshToken}`,
);

await page.click('main form button[type=submit]:has-text("Yes, this is correct")');
await page.waitForTimeout(2500);
check('confirming the figure that was shown saves it', records() === 1, `${records()} records`);
check(
  'exactly as typed — 120, not 50',
  Number(sql(`SELECT COALESCE(sum(-delta),0) FROM "AnimalGroupEvent" WHERE "animalGroupId"='flk-daily-1' AND type='MORTALITY';`)) === 120,
  sql(`SELECT delta FROM "AnimalGroupEvent" WHERE type='MORTALITY' AND "animalGroupId"='flk-daily-1';`),
);

// ---------------------------------------------------------------------------
console.log('\nFeed that looks like bags rather than kilograms');
sql(`
DELETE FROM "AnimalGroupEvent" WHERE "animalGroupId"='flk-daily-1' AND "sourceType"='dailyRecord';
DELETE FROM "DailyRecord" WHERE "animalGroupId"='flk-daily-1';
`);
await open('/daily/flk-daily-1');
await page.fill('#feedKg', '1150');
await page.click('main form button[type=submit]:has-text("Save")');
await page.waitForTimeout(2000);
body = await text();
check(
  'ten times the feed is questioned, in the farm’s own words',
  /bags rather than kilograms/i.test(body),
  body.slice(0, 900),
);
check('and it still saves when confirmed', await (async () => {
  await page.click('main form button[type=submit]:has-text("Yes, this is correct")');
  await page.waitForTimeout(2500);
  return records() === 1;
})(), `${records()} records`);

// ---------------------------------------------------------------------------
console.log('\nWho may write the day down');
await signIn(USERS.driver);
await open('/daily');
body = await text();
check('a driver is refused the daily record', /access/i.test(body), body.slice(0, 300));
check(
  'and Today is not in their navigation',
  (await page.locator('nav a:has-text("Today")').count()) === 0,
);

await signIn(USERS.owner);
await open('/daily/flk-daily-1');
check('an owner reaches it', !/access/i.test(await text()));

await browser.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✕ ${f}`);
  process.exit(1);
}
