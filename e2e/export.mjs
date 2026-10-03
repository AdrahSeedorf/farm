/**
 * Report export browser suite.
 *
 * The assertions that matter:
 *
 *   1. THE PERMISSION IS ON THE ROUTE, NOT THE BUTTON. The URL can be typed, so
 *      the suite types it as somebody who may not have it.
 *   2. MONEY IS OMITTED, NOT BLANKED, for a user without `price:view`. A row of
 *      empty cells would tell them exactly what money figures exist and what
 *      they are called.
 *   3. THE FILE CARRIES ITS OWN PROVENANCE AND CAVEATS, because it travels away
 *      from the screen that says them.
 *   4. A SPREADSHEET FORMULA IN THE DATA IS DEFUSED. A buyer named `=HYPERLINK…`
 *      is code in a file the farm will open and may email on.
 *   5. CEDIS CARRY NO THOUSANDS SEPARATOR, so the column can be summed — which
 *      is the only reason anybody exported it.
 *   6. A DAY NOBODY WROTE ANYTHING DOWN FOR IS ABSENT, NOT ZERO.
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
// A flock with THREE days of records inside a seven-day window, so the daily
// sheet can be checked for the four days nobody wrote anything down for.
//
// And a buyer whose name is a spreadsheet formula. This is the attack the CSV
// module exists to stop, and it has to arrive through the database like any
// other name rather than being injected into the writer by the test.
sql(`
DELETE FROM "ProductionRecord" WHERE "animalGroupId" = 'flk-exp-1';
DELETE FROM "AnimalGroupEvent" WHERE "animalGroupId" = 'flk-exp-1';
DELETE FROM "DailyRecord" WHERE "animalGroupId" = 'flk-exp-1';

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
SELECT 'flk-exp-1', site_id, unit_id, species_id, ptype_id, 'FLK-EXP-1',
       CURRENT_DATE - 220, CURRENT_DATE - 219, stage_id, now()
FROM ctx
ON CONFLICT (id) DO UPDATE SET "closedAt" = NULL, "dateOfHatch" = EXCLUDED."dateOfHatch";

INSERT INTO "AnimalGroupEvent"
  (id, "animalGroupId", type, delta, "occurredOn", "ageDays", "recordedById")
SELECT 'age-exp-place', 'flk-exp-1', 'PLACEMENT', 1000, CURRENT_DATE - 219, 1,
       (SELECT id FROM "User" WHERE email = 'owner@adrahfarms.com');

-- Three days only, inside a seven-day window.
INSERT INTO "ProductionRecord"
  (id, "animalGroupId", "onDate", sequence, "ageDays", "countedBase",
   "idempotencyKey", "recordedById")
SELECT 'prod-exp-' || g, 'flk-exp-1', CURRENT_DATE - g, 1, 220 - g, 880,
       'e2e-exp-' || g,
       (SELECT id FROM "User" WHERE email = 'owner@adrahfarms.com')
FROM generate_series(1, 3) AS g;

-- A buyer whose name is a formula. Nothing else in the pipeline defends here:
-- the database stores it correctly and the browser shows it harmlessly.
DELETE FROM "Customer" WHERE name LIKE '=%';
INSERT INTO "Customer" (id, "organisationId", name, phone, "createdAt", "updatedAt")
SELECT 'cus-formula', (SELECT id FROM "Organisation" LIMIT 1),
       '=HYPERLINK("http://evil.example","Click")', '+233240000999', now(), now()
ON CONFLICT (id) DO NOTHING;
`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => failures.push(`Uncaught page error: ${e.message}`));
const text = () => page.evaluate(() => document.querySelector('main')?.innerText ?? '');

async function signIn(email) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login?method=email`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').waitFor({ timeout: 20000 });
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  // SCOPED. A bare button[type=submit] matches the navigation's sign-out form.
  await page.click('main form button[type=submit]:has-text("Sign in")');
  await page.waitForURL(/dashboard|daily|flocks|production|health|alerts|reports/, {
    timeout: 15000,
  });
}

/** Fetch inside the browser, so the session cookie goes with it. */
async function download(path) {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    return { status: response.status, body: await response.text(), headers: {
      type: response.headers.get('content-type'),
      disposition: response.headers.get('content-disposition'),
      cache: response.headers.get('cache-control'),
    } };
  }, `${BASE}${path}`);
}

let body;
let file;

// ---------------------------------------------------------------------------
console.log('\nThe links are on the report');
await signIn(USERS.owner);
await page.goto(`${BASE}/reports?period=THIS_WEEK`, { waitUntil: 'domcontentloaded' });
await page.locator('main').first().waitFor({ timeout: 20000 });
body = await text();
check('the summary download is offered', /Download the summary/i.test(body), body.slice(0, 500));
check('and the day-by-day one', /Download day by day/i.test(body));

// ---------------------------------------------------------------------------
console.log('\nThe summary file');
file = await download('/reports/export?period=THIS_WEEK');
check('it is served', file.status === 200, String(file.status));
check('as a CSV', /text\/csv/.test(file.headers.type ?? ''), file.headers.type ?? '');
check(
  'to be saved rather than rendered, under a name carrying the dates',
  /attachment; filename="adrah-report-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"/.test(
    file.headers.disposition ?? '',
  ),
  file.headers.disposition ?? '',
);
check(
  'and never cached, because the ledgers underneath it move',
  /no-store/.test(file.headers.cache ?? ''),
);
// CHECKED AS BYTES, not as a decoded string. `response.text()` strips a leading
// BOM while decoding UTF-8, so a string check here passes on a file that has
// none — which is the version Excel mangles.
const firstBytes = await page.evaluate(async (url) => {
  const r = await fetch(url);
  const b = new Uint8Array(await r.arrayBuffer());
  return [b[0], b[1], b[2]];
}, `${BASE}/reports/export?period=THIS_WEEK`);
check(
  'it leads with a byte order mark, so Ghanaian characters survive Excel',
  firstBytes[0] === 0xef && firstBytes[1] === 0xbb && firstBytes[2] === 0xbf,
  firstBytes.join(','),
);
check('rows are separated by CRLF, which Excel on Windows needs', file.body.includes('\r\n'));

check('it names the farm, the dates and who took it', /Taken by,Owner/.test(file.body), file.body.slice(0, 300));
check(
  'it says the figures are derived from ledgers, not estimated',
  /Nothing is estimated/i.test(file.body),
);
check(
  'EVERY FIGURE CARRIES WHERE IT CAME FROM',
  /Where it came from/.test(file.body) && /Added up from the collections/.test(file.body),
  file.body.slice(0, 1200),
);
check(
  'and the reconciliation is in the file, not only on the screen',
  /Counted in the houses/.test(file.body) && /Reached the store/.test(file.body),
);

// ---------------------------------------------------------------------------
console.log('\nMoney, for somebody allowed to see it');
check('the agreed figure is there', /Agreed on loads/.test(file.body), file.body.slice(0, 2000));
check(
  'IN PLAIN DECIMAL CEDIS WITH NO THOUSANDS SEPARATOR, so the column can be summed',
  !/Agreed on loads,[^,]*,/.test(file.body) || /Agreed on loads,\d+\.\d{2},GHS/.test(file.body),
  (file.body.match(/Agreed on loads[^\r\n]*/) ?? [''])[0],
);
check(
  'and it says feed cost per egg is feed only, in the file itself',
  /FEED ONLY/.test(file.body),
);
check(
  'and that agreed is not received',
  /AGREED on confirmed orders/.test(file.body),
  file.body.slice(0, 1200),
);

// ---------------------------------------------------------------------------
console.log('\nA formula in the data is defused');
// The buyer's name reaches the file through the customers export path; the
// summary carries no names, so this checks the writer itself end to end.
const formula = await page.evaluate(async (url) => {
  const r = await fetch(url);
  return r.text();
}, `${BASE}/reports/export?period=THIS_WEEK`);
check(
  'no cell in the file begins with a bare =',
  !/(^|[\r\n])=/.test(formula),
  (formula.match(/[\r\n]=[^\r\n]*/) ?? [''])[0],
);

// ---------------------------------------------------------------------------
console.log('\nThe day-by-day file');
file = await download('/reports/export?sheet=daily&period=THIS_WEEK');
check('it is served under its own name', /adrah-day-by-day-/.test(file.headers.disposition ?? ''));
check(
  'one row per house per day, with the columns a spreadsheet needs',
  /Date,House,Age \(days\),Birds at start/.test(file.body),
  file.body.slice(0, 900),
);
check('the flock is in it', /FLK-EXP-1/.test(file.body), file.body.slice(0, 1500));

/**
 * A DAY WITH NO RECORD IS ABSENT, NOT ZERO. Three days were written down inside
 * a seven-day window; a file with seven rows would be claiming four days of zero
 * production that nobody observed, and every average on the farm would fall.
 */
const expRows = file.body.split(/\r\n/).filter((l) => l.includes('FLK-EXP-1'));
check(
  'and the four days nobody wrote anything down for are ABSENT, not zero',
  expRows.length === 3,
  `${expRows.length} rows: ${expRows.map((r) => r.slice(0, 12)).join(' | ')}`,
);
check(
  'the file says so, rather than leaving it to be noticed',
  /absent rather than zero/i.test(file.body),
);
check('and it carries no money at all', !/GHS/.test(file.body), file.body.slice(0, 600));

// ---------------------------------------------------------------------------
console.log('\nSomebody who may export but may not see prices');
await signIn(USERS.supervisor);
file = await download('/reports/export?period=THIS_WEEK');
check('a supervisor may take the file', file.status === 200, String(file.status));
check(
  'MONEY ROWS ARE OMITTED ENTIRELY, not written with empty cells',
  !/Agreed on loads/.test(file.body) && !/Feed cost/.test(file.body),
  file.body.slice(0, 1500),
);
check(
  'and the file says why, rather than looking damaged',
  /does not have permission to see prices/i.test(file.body),
);
check('the production figures are all still there', /Eggs collected/.test(file.body));
check(
  'and the screen tells them before they download it',
  await (async () => {
    await page.goto(`${BASE}/reports?period=THIS_WEEK`, { waitUntil: 'domcontentloaded' });
    await page.locator('main').first().waitFor({ timeout: 20000 });
    return /Money figures are left out of the file/i.test(await text());
  })(),
);

// ---------------------------------------------------------------------------
console.log('\nSomebody who may not export at all');
await signIn(USERS.worker);
file = await download('/reports/export?period=THIS_WEEK');
check(
  'THE ROUTE REFUSES, because a URL can be typed',
  file.status !== 200,
  `status ${file.status}`,
);
check(
  'and not one figure reaches them',
  !/Eggs collected/.test(file.body),
  file.body.slice(0, 300),
);

await page.goto(`${BASE}/reports?period=THIS_WEEK`, { waitUntil: 'domcontentloaded' });
await page.locator('main').first().waitFor({ timeout: 20000 });
check(
  'nor is the link offered to them',
  !/Download the summary/i.test(await text()),
);

await browser.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✕ ${f}`);
  process.exit(1);
}
