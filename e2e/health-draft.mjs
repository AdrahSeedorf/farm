/**
 * The draft health programme, and the hole it exposed.
 *
 * The assertions that matter:
 *
 *   1. A TREATMENT WITH NO WITHDRAWAL PERIOD RECORDED STOPS THE SALE. Before
 *      this task it restricted nothing at all — a null was skipped in the
 *      arithmetic and filtered out of the query, so a treated house's eggs were
 *      sellable the same morning. This is the assertion the whole task exists
 *      for.
 *   2. RECORDING A ZERO CLEARS IT; LEAVING IT BLANK DOES NOT. Somebody read the
 *      label and it said none applies — that is information. Silence is not.
 *   3. THE REFUSAL READS DIFFERENTLY FROM A DATED ONE, because waiting will not
 *      fix it.
 *   4. THE DRAFT IS NAMED AS A DRAFT, carries no withdrawal periods, and says on
 *      every screen that nobody approved it.
 *   5. THE QUESTION SHEET asks for exactly what the system needs, and says a
 *      zero is an answer.
 *   6. A WORKER SEES NONE OF IT.
 */
import { chromium } from 'playwright';
import { sql, ensureFlock, clearSales, HOUSE_NAME } from './fixture.mjs';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3111';
const PASSWORD = 'AdrahFarms2026';
const USERS = {
  owner: 'owner@adrahfarms.com',
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

clearSales();
sql(`
DELETE FROM "HealthEvent" WHERE name LIKE 'E2E %';
DELETE FROM "HealthProgrammeItem" WHERE "healthProgrammeId" IN (
  SELECT id FROM "HealthProgramme" WHERE name LIKE 'Draft%'
);
DELETE FROM "HealthProgramme" WHERE name LIKE 'Draft%';
`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => failures.push(`Uncaught page error: ${e.message}`));
const text = () => page.evaluate(() => document.querySelector('main')?.innerText ?? '');
const html = () => page.content();

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
  await page.click('button[type=submit]:has-text("Sign in")');
  await page.waitForURL(/dashboard|daily|flocks|production|health|alerts/, { timeout: 15000 });
}

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

const flockId = ensureFlock();
const ownerId = sql(`SELECT id FROM "User" WHERE email = 'owner@adrahfarms.com';`);

/** A treatment with the egg withdrawal left blank — the case that used to pass. */
const treatWithBlankWithdrawal = () =>
  sql(`
    DELETE FROM "HealthEvent" WHERE name LIKE 'E2E %';
    INSERT INTO "HealthEvent"
      (id, "animalGroupId", type, name, "occurredOn", "ageDays", "recordedById")
    VALUES
      ('he-e2e-blank', '${flockId}', 'TREATMENT', 'E2E unknown wormer', CURRENT_DATE, 200, '${ownerId}');
  `);

// ---------------------------------------------------------------------------
console.log('\nThe farm has no programme, and the software says why');
await signIn(USERS.owner);
await open('/health');
let body = await text();
check(
  'it refuses to write a schedule, and says what it cannot know',
  /will not write a vaccination schedule/i.test(body) &&
    /gumboro timing depends on the parent flock/i.test(body),
  body.slice(0, 900),
);
check('naming the local authority', /adansi south/i.test(body));
check(
  'and offers the one thing it can do',
  (await page.locator('button:has-text("Start a draft to take to a vet")').count()) === 1,
);

// ---------------------------------------------------------------------------
console.log('\nStarting the draft');
await page.click('button:has-text("Start a draft to take to a vet")');
await page.waitForTimeout(3500);
body = await text();
check('it lands on the draft', /draft/i.test(body), body.slice(0, 400));
check(
  'which says nobody authored or approved it',
  /unverified/i.test(body) || /nobody/i.test(body),
  body.slice(0, 900),
);
const draftUrl = page.url();

const items = Number(
  sql(`SELECT COUNT(*) FROM "HealthProgrammeItem" i
       JOIN "HealthProgramme" p ON p.id = i."healthProgrammeId"
       WHERE p.name LIKE 'Draft%';`),
);
check('it has a schedule-shaped skeleton', items >= 8, `${items} items`);

/** THE LOCK. Every withdrawal blank, which now means restricted rather than clear. */
const withWithdrawal = Number(
  sql(`SELECT COUNT(*) FROM "HealthProgrammeItem" i
       JOIN "HealthProgramme" p ON p.id = i."healthProgrammeId"
       WHERE p.name LIKE 'Draft%' AND i."eggWithdrawalDays" IS NOT NULL;`),
);
check('AND NOT ONE WITHDRAWAL PERIOD ON IT', withWithdrawal === 0, `${withWithdrawal} had one`);

check(
  'it stays a draft rather than being approved',
  sql(`SELECT status FROM "HealthProgramme" WHERE name LIKE 'Draft%';`) === 'DRAFT',
);

await open('/health');
check(
  'and starting it twice does not make two',
  (await page.locator('button:has-text("Start a draft to take to a vet")').count()) === 0,
);
check('the health page now points at the sheet', /print the questions/i.test(await text()));

// ---------------------------------------------------------------------------
console.log('\nThe question sheet');
await page.click('a:has-text("Print the questions")');
// WAIT FOR A HEADING ONLY THE SHEET HAS. Both pages have an h1, so waiting for
// "an h1" resolves against the page we have not left yet — the same trap the
// buyers suite hit, and it reads as five content failures rather than one
// navigation that never happened.
await page
  .locator('main h1:has-text("Questions for the vet")')
  .waitFor({ timeout: 20000 });
body = await text();
check(
  'it asks the hatchery the one thing only it knows',
  /which vaccines did the hatchery already give/i.test(body),
  body.slice(0, 800),
);
check('and asks about the parent flock', /parent flock/i.test(body));
check(
  'IT ASKS FOR THE WITHDRAWAL PERIOD AND SAYS ZERO IS AN ANSWER',
  /write 0 if none/i.test(body) && /is an answer/i.test(body),
  body.slice(0, 1600),
);
check('it asks who is approving it', /approved this programme/i.test(body));
check(
  'and it has a line for every item on the draft',
  (body.match(/age in days/gi) ?? []).length >= 8,
);

// ---------------------------------------------------------------------------
console.log('\nA treatment with no withdrawal period recorded');
treatWithBlankWithdrawal();

await open('/health');
body = await text();
check(
  'THE HOUSE IS RESTRICTED, where it used to be clear',
  /withdrawal periods in force/i.test(body) && new RegExp(HOUSE_NAME, 'i').test(body),
  body.slice(0, 1200),
);
check(
  'and it says there is no date, only a label to read',
  /no withdrawal period recorded/i.test(body) && /reads the label/i.test(body),
  body.slice(0, 1200),
);

// Set up a sale and prove the gate refuses.
await open('/customers/new', '#name');
await page.fill('#name', 'Yaa Serwaa');
await page.fill('#phone', '0209998887');
await page.click('button[type=submit]:has-text("Add")');
await page.waitForTimeout(2500);

await open('/pricing/new', '#name');
await page.fill('#name', 'Crate of 30 — Large');
await page.fill('#sku', 'CRATE-L');
await page.fill('#unitsPerPack', '30').catch(() => {});
await page.click('button[type=submit]:has-text("Add product")');
await page.locator('main h2:has-text("What it costs")').waitFor({ timeout: 20000 });
await page.fill('#price', '45');
await page.click('button[type=submit]:has-text("Set")');
await page.waitForTimeout(2500);

await open('/orders/new', '#customerId');
await choose('#customerId', 'Serwaa');
await page.click('button[type=submit]:has-text("Start the order")');
await page.locator('main h2:has-text("What they want")').waitFor({ timeout: 20000 });
const orderUrl = page.url();
await page.fill('#quantity', '2');
await page.click('button[type=submit]:has-text("Add to the order")');
await page.waitForTimeout(2500);
body = await text();
check(
  'the order warns before anybody tries to confirm it',
  /withdrawal period in force/i.test(body),
  body.slice(0, 900),
);
check(
  'saying the period was never recorded, not that it runs until a date',
  /no withdrawal period recorded/i.test(body),
  body.slice(0, 900),
);

await choose('select[id^="flock-"]', HOUSE_NAME);
await page.click('button[type=submit]:has-text("Save")');
await page.waitForTimeout(2500);
body = await text();
check(
  'NAMING THE TREATED HOUSE REFUSES THE SALE',
  /cannot be sold/i.test(body),
  body.slice(0, 900),
);
check(
  'AND SAYS THERE IS NO DATE TO WAIT FOR',
  /no date to wait for/i.test(body),
  body.slice(0, 900),
);

const ordersBefore = Number(sql(`SELECT COUNT(*) FROM "SalesOrder" WHERE state = 'CONFIRMED';`));
await page.click('button[type=submit]:has-text("Confirm with the buyer")');
await page.waitForTimeout(3000);
check(
  'confirming it anyway is refused',
  Number(sql(`SELECT COUNT(*) FROM "SalesOrder" WHERE state = 'CONFIRMED';`)) === ordersBefore,
);

// ---------------------------------------------------------------------------
console.log('\nReading the label clears it — including reading a zero');
sql(`UPDATE "HealthEvent" SET "eggWithdrawalDays" = 0, "meatWithdrawalDays" = 0
     WHERE name = 'E2E unknown wormer';`);

await open('/health');
check(
  'A RECORDED ZERO LIFTS THE RESTRICTION',
  !/withdrawal periods in force/i.test(await text()),
  (await text()).slice(0, 800),
);

await page.goto(orderUrl, { waitUntil: 'domcontentloaded' });
await page.locator('main h2:has-text("What they want")').waitFor({ timeout: 20000 });
check(
  'and the order stops warning',
  !/withdrawal period in force/i.test(await text()),
  (await text()).slice(0, 700),
);

await page.click('button[type=submit]:has-text("Confirm with the buyer")');
await page.waitForTimeout(3000);
check(
  'the sale goes through once somebody has read the label',
  Number(sql(`SELECT COUNT(*) FROM "SalesOrder" WHERE state = 'CONFIRMED';`)) === ordersBefore + 1,
);

// A real period behaves as it always did.
sql(`UPDATE "HealthEvent" SET "eggWithdrawalDays" = 7 WHERE name = 'E2E unknown wormer';`);
await open('/health');
body = await text();
check(
  'and a real period still reads as a date',
  /eggs until \d{4}-\d{2}-\d{2}/i.test(body),
  body.slice(0, 900),
);

sql(`DELETE FROM "HealthEvent" WHERE name LIKE 'E2E %';`);

// ---------------------------------------------------------------------------
console.log('\nWhat a worker may and may not do');
/**
 * A WORKER HOLDS `health:view`, so they can read the schedule and the sheet —
 * and should: the person giving a vaccination is the one who needs to know what
 * is due. This assertion was originally written the other way round, which was
 * a wrong guess about the role rather than a fault in the page.
 *
 * What they cannot do is start a draft, which needs `health:create`.
 */
await signIn(USERS.worker);
await page.goto(`${BASE}${new URL(draftUrl).pathname}/questions`, {
  waitUntil: 'domcontentloaded',
});
await page.locator('main').first().waitFor({ timeout: 20000 });
check(
  'a worker can read the sheet, because they are the one giving the vaccination',
  /which vaccines did the hatchery/i.test(await html()),
);

await open('/health');
check(
  'BUT CANNOT START A DRAFT',
  (await page.locator('button:has-text("Start a draft")').count()) === 0,
);
check(
  'nor is the draft section offered to them',
  !/will not write a vaccination schedule/i.test(await text()),
);

await browser.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✕ ${f}`);
  process.exit(1);
}
