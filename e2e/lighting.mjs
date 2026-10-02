/**
 * Lighting browser suite.
 *
 * The assertions that matter, and why each one exists:
 *
 *   1. NO LATITUDE, NO TIMES. The farm's coordinates are nullable and nothing
 *      fills them in. Defaulting to 6°N because the farm is "in Ghana" would be
 *      a guess wearing the clothes of a measurement, and the screen must say so
 *      rather than print a confident wrong hour.
 *   2. WITH A LATITUDE, A SWITCH TIME. Not a number of hours to convert at five
 *      in the morning — a clock time.
 *   3. THE COST IS STATED AS A RUNNING COST. At 6°N the lamps run every day of
 *      lay for seventy weeks, and a farm should read that before buying a bird.
 *   4. A LAMP CANNOT SHORTEN A DAY. Most houses here are open-sided, so a step
 *      below the natural day is unachievable and nothing else would reveal it.
 *   5. SHORTENING THE DAY IN LAY WARNS AND THEN SAVES. Warn, never block — an
 *      induced moult is a real practice, and refusing it would mean the software
 *      had decided it knows the birds better than the farmer.
 *   6. THE DRAFT SAYS IT IS A DRAFT, everywhere it appears.
 *   7. A WORKER CAN READ THE SWITCH TIME AND CANNOT CHANGE THE PROGRAMME. They
 *      are the one flipping the switch; they are not the one deciding the plan.
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3111';
const PASSWORD = 'AdrahFarms2026';
const USERS = {
  owner: 'owner@adrahfarms.com',
  supervisor: 'supervisor@adrahfarms.com',
  worker: 'worker@adrahfarms.com',
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
  execSync(`su postgres -c 'psql -h /tmp -p 5433 -d adrah -q -t -A' <<'SQL'\n${body}\nSQL`, {
    stdio: 'pipe',
    shell: '/bin/bash',
  })
    .toString()
    .trim();

// --- the fixture ------------------------------------------------------------
//
// The farm starts with NO coordinates, because that is the real starting state
// and the first thing this suite checks. A laying-age flock, so the programme
// has something to say.
sql(`
DELETE FROM "LightingStep";
DELETE FROM "LightingProgramme";
UPDATE "Site" SET latitude = NULL, longitude = NULL;

WITH ctx AS (
  SELECT
    (SELECT id FROM "Site" ORDER BY "createdAt" LIMIT 1)                   AS site_id,
    (SELECT id FROM "ProductionUnit" WHERE name = 'House A' LIMIT 1)       AS unit_id,
    (SELECT id FROM "SpeciesProfile" ORDER BY "createdAt" LIMIT 1)         AS species_id,
    (SELECT id FROM "ProductionTypeProfile" ORDER BY "createdAt" LIMIT 1)  AS ptype_id,
    (SELECT id FROM "LifecycleStage" WHERE key = 'laying' LIMIT 1)         AS stage_id
)
INSERT INTO "AnimalGroup"
  (id, "siteId", "productionUnitId", "speciesProfileId", "productionTypeProfileId",
   code, "dateOfHatch", "arrivalDate", "currentStageId", "updatedAt")
SELECT 'flk-light-1', site_id, unit_id, species_id, ptype_id, 'FLK-LIGHT-1',
       CURRENT_DATE - 200, CURRENT_DATE - 199, stage_id, now()
FROM ctx
ON CONFLICT (id) DO UPDATE SET "dateOfHatch" = EXCLUDED."dateOfHatch", "closedAt" = NULL;
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
  // SCOPED. A bare button[type=submit] matches the navigation's sign-out form,
  // and the suite signs itself out — which looks exactly like a permission bug.
  await page.click('main form button[type=submit]:has-text("Sign in")');
  await page.waitForURL(/dashboard|daily|flocks|production|health|alerts|lighting/, {
    timeout: 15000,
  });
}

/** Wait for a heading unique to the DESTINATION — `main h1` resolves instantly. */
const waitForHeading = (fragment) =>
  page.locator(`main h1:has-text("${fragment}")`).first().waitFor({ timeout: 20000 });

async function choose(selector, fragment) {
  const value = await page.$eval(
    selector,
    (el, frag) =>
      [...el.options].find((o) => o.textContent.toLowerCase().includes(frag.toLowerCase()))?.value,
    fragment,
  );
  if (value === undefined) throw new Error(`No option matching "${fragment}" in ${selector}`);
  await page.selectOption(selector, value);
}

let body;

// ---------------------------------------------------------------------------
console.log('\nBefore there is a programme');
await signIn(USERS.owner);
await open('/lighting');
body = await text();
check('Lighting is on the screen', /Lighting/.test(body));
check(
  'and says the farm needs lamps every day rather than seasonally',
  /every day, not seasonally/i.test(body),
  body.slice(0, 400),
);
check(
  'it says no programme exists, so no house can be told what to do',
  /no lighting programme yet/i.test(body),
  body.slice(0, 700),
);
check('and offers the draft without dressing it up as a recommendation', /not a recommendation/i.test(body));

// ---------------------------------------------------------------------------
console.log('\nThe draft, and the fact nobody has checked it');
await page.click('main form button[type=submit]:has-text("Start a draft")');
await waitForHeading('Draft');
body = await text();
check('the draft exists', /Draft — to be confirmed with the hatchery/i.test(body));
check(
  'and says plainly that nobody qualified has looked at it',
  /has not been checked by a hatchery or a veterinarian/i.test(body),
);
check(
  'AND NAMES THE THING MOST LIKELY TO GO WRONG — weight, not age',
  /body weight, not on the ages/i.test(body),
  body.slice(0, 800),
);
check('it has the eleven steps', /Day 0/.test(body) && /Day 210/.test(body));
check(
  'the brooding step-down is NOT warned about, because every guide prescribes it',
  !/Day 7 shortens the day/i.test(body),
  body.slice(0, 1500),
);
check(
  'the hold-at-week-30 row explains that it deliberately changes nothing',
  /HOLD/.test(body) && /how a moult is induced/i.test(body),
);
check(
  'and the questions for the hatchery lead with the one that decides the rest',
  /open-sided, or can it be darkened/i.test(body),
  body.slice(0, 2000),
);

check(
  'it became the programme in use, so the houses are not left with nothing',
  sql(`SELECT "isDefault" FROM "LightingProgramme" LIMIT 1;`) === 't',
);

// ---------------------------------------------------------------------------
console.log('\nNo latitude, no times — and it says so');
await open('/lighting');
body = await text();
check(
  'the house reports that no latitude is recorded',
  /no latitude recorded/i.test(body),
  body.slice(0, 900),
);
check(
  'AND PRINTS NO SWITCH-ON TIME AT ALL rather than guessing one',
  !/on at \d\d:\d\d/i.test(body),
  body.slice(0, 900),
);
check('it says where to fix it', /Settings → Farms/i.test(body));

// ---------------------------------------------------------------------------
console.log('\nWith the farm on the map');
sql(`UPDATE "Site" SET latitude = 6.0833, longitude = -1.0167;`);
await open('/lighting');
body = await text();
check('the natural day is about twelve hours', /sky gives\s*12h/i.test(body), body.slice(0, 900));
check(
  'A CLOCK TIME, not a number of hours to convert at dawn',
  /on at \d\d:\d\d/.test(body),
  body.slice(0, 900),
);
check('it names sunrise and sunset', /Sunrise \/ sunset/i.test(body));
check(
  'and reports the dark period, which is what the birds actually get',
  /Dark/.test(body),
);
check(
  'the lamps make up the difference between 15h and the real daylength',
  /2h 5\dm of lamps: on at 0\d:\d\d/i.test(body),
  body.slice(0, 900),
);
check(
  'AND IT ADMITS THE SWITCH TIME IS IN THE SMALL HOURS, naming the cheap fix',
  /start for whoever flips the switch/i.test(body) && /time switch/i.test(body),
  body.slice(0, 1200),
);
check(
  'the draft label follows the figures onto this screen',
  /unchecked draft/i.test(body),
);

// ---------------------------------------------------------------------------
console.log('\nWhat this latitude costs, said before a bird is bought');
await open('/lighting');
await page.click('main a:has-text("Draft — to be confirmed")');
await waitForHeading('Draft');
body = await text();
check(
  'the running cost is stated as a running cost',
  /EVERY DAY OF LAY/.test(body) && /running cost/i.test(body),
  body.slice(0, 1200),
);
check('in lamp-hours rather than in invented cedis', /lamp-hours/i.test(body) && !/GHS/.test(body));

// ---------------------------------------------------------------------------
console.log('\nA lamp cannot shorten a day');
// Week 30 held at 15h; ask for 10h, which no switch can deliver in an open house.
// Day 190, which this flock HAS reached — a step at 220 would be saved and
// then ignored, and the house would go on reporting the 15h hold.
await page.fill('#ageDays', '190');
await page.fill('#totalHours', '10');
await page.click('main form button[type=submit]:has-text("Save this step")');
await page.waitForTimeout(1500);
body = await text();
check(
  'shortening the day in lay WARNS, in capitals, and explains the consequence',
  /SHORTENS/.test(body) && /how a moult is induced/i.test(body),
  body.slice(0, 900),
);
check('and says nothing has been saved yet', /Nothing has been saved yet/i.test(body));
check(
  'while leaving the decision with the farmer',
  /this software does not know them/i.test(body),
);
check('the typed values are still in the boxes', (await page.inputValue('#ageDays')) === '190');

await page.click('main form button[type=submit]:has-text("Yes, save it")');
// Poll rather than guess at a timeout. The write is committed when the row is
// there; a fixed wait either flakes or wastes time.
let saved = '';
for (let i = 0; i < 20 && saved !== '10'; i++) {
  await page.waitForTimeout(300);
  saved = sql(`SELECT "totalHours" FROM "LightingStep" WHERE "ageDays" = 190;`);
}
check('confirming saves it — warn, never block', saved === '10', saved);

await open('/lighting');
body = await text();
check(
  'and the house now says a lamp cannot do it',
  /A lamp cannot shorten a day/i.test(body),
  body.slice(0, 900),
);
check(
  'naming the real fix, which is a building decision',
  /open-sided house/i.test(body) && /blacked out/i.test(body),
);

// ---------------------------------------------------------------------------
console.log('\nEditing the draft stops it being the shipped draft');
check(
  'it is no longer labelled an unchecked draft',
  sql(`SELECT "isDraft" FROM "LightingProgramme" LIMIT 1;`) === 'f',
);

// ---------------------------------------------------------------------------
console.log('\nWhere the extra hours go');
await open('/lighting');
await page.click('main a:has-text("Draft — to be confirmed")');
await waitForHeading('Draft');
// Put the 15h hold back so the mode change has something to move.
await page.fill('#ageDays', '190');
await page.fill('#totalHours', '15');
await page.click('main form button[type=submit]:has-text("Save this step")');
await page.waitForTimeout(1500);
// A BLANK LUX MUST NOT FORCE A CONFIRMATION. It is true of almost every row on
// almost every farm, and making it a confirmation meant every correct save
// needed two clicks — which is how people learn to click past the warning that
// mattered.
check(
  'an ordinary step with no lux saves in ONE click, not two',
  !/Read this before saving/i.test(await text()),
  (await text()).slice(0, 400),
);

await choose('#mode', 'Half before sunrise');
// :text-is, NOT :has-text. "Save" is a substring of "Save this step", so
// has-text matched the step form and saved a step instead of the mode.
await page.click('main form button[type=submit]:text-is("Save")');
await page.waitForTimeout(1500);
await open('/lighting');
body = await text();
check(
  'splitting it gives two runs instead of one pre-dawn marathon',
  /on at \d\d:\d\d.*then.*on at sunset/is.test(body),
  body.slice(0, 1000),
);
check(
  'and it no longer suggests splitting what is already split',
  !/Splitting it/i.test(body),
);

// ---------------------------------------------------------------------------
console.log('\nWho may set the lights');
await signIn(USERS.worker);
await open('/lighting');
body = await text();
check('a worker CAN read the switch-on time — they are the one flipping it', /on at \d\d:\d\d/.test(body), body.slice(0, 600));
check(
  'but is offered no way to change the programme',
  (await page.locator('main form button:has-text("Save")').count()) === 0,
);

await signIn(USERS.supervisor);
await open('/lighting');
await page.click('main a:has-text("Draft — to be confirmed")');
await waitForHeading('Draft');
check(
  'a supervisor, who runs the house, can',
  (await page.locator('main form button:has-text("Save this step")').count()) > 0,
);

await browser.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✕ ${f}`);
  process.exit(1);
}
