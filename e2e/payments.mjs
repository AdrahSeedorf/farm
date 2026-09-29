/**
 * Task 15.6 browser suite — money in.
 *
 * The assertions that matter:
 *
 *   1. A BALANCE IS DERIVED. Confirm an order for GHS 450 and the buyer owes
 *      GHS 450 — on their own page and on the money screen, which are written
 *      weeks apart and must agree.
 *   2. RECORDING MONEY MOVES IT. GHS 200 in, GHS 250 owed, on both screens.
 *   3. A REVERSAL PUTS IT BACK, and the payment stays on the record with why.
 *   4. THE WORD "OWES" IS ONLY USED WHEN SOMETHING IS OWED — a settled buyer
 *      reads as settled, and one who paid ahead reads as paid ahead.
 *   5. CASH IS ASKED FOR A NAME, NOT A REFERENCE. MoMo is the other way round.
 *   6. DRAFTS ARE NOT DEBTS.
 *   7. A WORKER SEES NONE OF IT, and neither does the page source.
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

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

const sql = (body) =>
  execSync(`su postgres -c 'psql -h /tmp -p 5433 -d adrah -q -t -A' <<'SQL'\n${body}\nSQL`, {
    stdio: 'pipe',
    shell: '/bin/bash',
  })
    .toString()
    .trim();

/** The suite clears its own rows first, in foreign-key order. */
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

/** A controlled Select carries its name on a hidden input, so match on id. */
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

/**
 * Submit the payment form, whichever label it is currently wearing.
 *
 * The button reads "Record the payment" until a warning comes back and "Yes,
 * record it as it stands" afterwards — deliberately, so nobody confirms
 * something they have not read. A suite that hard-codes one label breaks the
 * moment it exercises the warning path, which is the path worth exercising.
 */
async function submitPayment() {
  await page
    .locator('button[type=submit]:has-text("Record the payment"), button[type=submit]:has-text("Yes, record it as it stands")')
    .first()
    .click();
  await page.waitForTimeout(3000);
}


// ---------------------------------------------------------------------------
console.log('\nBefore anything is owed');
await signIn(USERS.owner);
await open('/payments');
let body = await text();
check('Money in is in the nav', (await page.locator('nav a:has-text("Money in")').count()) > 0);
check('it says nothing has come in', /nothing received yet/i.test(body), body.slice(0, 400));
check(
  'and that nobody owes anything, with why somebody would appear',
  /nobody owes anything/i.test(body) && /once an order is confirmed/i.test(body),
  body.slice(0, 700),
);
check(
  'the screen is honest that it talks to no bank',
  /talks to a bank or a mobile money provider/i.test(body),
  body.slice(0, 1200),
);

// ---------------------------------------------------------------------------
console.log('\nA buyer, a product, and an order for GHS 450');
await open('/customers/new', '#name');
await page.fill('#name', 'Yaa Serwaa');
await page.fill('#phone', '0209998887');
await page.fill('#businessName', 'Serwaa Cold Store').catch(() => {});
await page.click('button[type=submit]:has-text("Add")');
await page.waitForTimeout(2500);

await open('/pricing/new', '#name');
await page.fill('#name', 'Crate of 30 — Large');
await page.fill('#sku', 'CRATE-L');
await page.fill('#unitsPerPack', '30').catch(() => {});
await page.fill('#packLabel', 'crate').catch(() => {});
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
await page.fill('#quantity', '10');
await page.click('button[type=submit]:has-text("Add to the order")');
await page.waitForTimeout(2500);
check('the order is worth GHS 450', /GHS 450\.00/.test(await text()), (await text()).slice(0, 600));

/** A draft is an order nobody agreed. Charging for it would be inventing a debt. */
const customerUrl = `/customers/${sql(`SELECT id FROM "Customer" WHERE name = 'Yaa Serwaa';`)}`;
await open(customerUrl, 'main h1');
body = await text();
check(
  'A DRAFT IS NOT A DEBT',
  /nothing confirmed and nothing received/i.test(body),
  body.slice(0, 900),
);

await page.goto(`${BASE}${orderUrl.replace(BASE, '')}`, { waitUntil: 'domcontentloaded' });
await page.locator('main h2:has-text("What they want")').waitFor({ timeout: 20000 });
await page.click('button[type=submit]:has-text("Confirm with the buyer")');
await page.waitForTimeout(3000);

await open(customerUrl, 'main h1');
body = await text();
check(
  'once confirmed, the buyer owes GHS 450',
  /owes GHS 450\.00/i.test(body),
  body.slice(0, 900),
);
check(
  'and the page says where that came from',
  /GHS 450\.00 agreed across 1 confirmed order/i.test(body),
  body.slice(0, 900),
);

/** Two screens written weeks apart, one definition of what is owed. */
await open('/payments');
body = await text();
check(
  'THE MONEY SCREEN AGREES WITH THE BUYER PAGE',
  /Serwaa/.test(body) && /GHS 450\.00/.test(body),
  body.slice(0, 900),
);

// ---------------------------------------------------------------------------
console.log('\nMoney arrives');
// The money screen's form serves every buyer, so one has to be chosen. The
// buyer's own page has no such field — see the fixedCustomerId branch.
await choose('#customerId', 'Serwaa');
await page.fill('#amount', '200');
await choose('#method', 'Mobile money');
await page.waitForTimeout(400);
check(
  'MOMO IS ASKED FOR A REFERENCE, NOT A NAME',
  (await page.locator('#externalRef').count()) === 1 &&
    (await page.locator('#receivedBy').count()) === 0,
);
await page.fill('#externalRef', 'MP260929.1432.A12345');
await submitPayment();
body = await text();
check('it is recorded with a receipt number', /PAY-\d{4}-\d{4}/.test(body), body.slice(0, 500));
check(
  'and the new balance comes back with it',
  /owes GHS 250\.00/i.test(body),
  body.slice(0, 600),
);

await open(customerUrl, 'main h1');
check(
  'THE BUYER PAGE HAS MOVED TOO',
  /owes GHS 250\.00/i.test(await text()),
  (await text()).slice(0, 900),
);

// ---------------------------------------------------------------------------
console.log('\nCash is a different question');
await open('/payments');
await choose('#customerId', 'Serwaa');
await choose('#method', 'Cash');
await page.waitForTimeout(400);
check(
  'CASH IS ASKED WHO TOOK IT, AND NOT FOR A REFERENCE',
  (await page.locator('#receivedBy').count()) === 1 &&
    (await page.locator('#externalRef').count()) === 0,
);

await page.fill('#amount', '250');
await submitPayment();
body = await text();
check(
  'CASH WITH NOBODY NAMED WARNS RATHER THAN REFUSING',
  /check this before writing a receipt/i.test(body) && /only record a cash payment leaves/i.test(body),
  body.slice(0, 900),
);
check('and says nothing has been saved yet', /nothing has been saved yet/i.test(body));
check(
  'the amount somebody typed is still in the box',
  (await page.locator('#amount').inputValue()) === '250',
);

await page.fill('#receivedBy', 'Kofi Mensah');
await submitPayment();
body = await text();
check('naming somebody lets it through', /PAY-\d{4}-\d{4}/.test(body), body.slice(0, 500));

/** A screen that prints "owes GHS 0.00" invites ringing somebody who owes nothing. */
check(
  'AND A SETTLED BUYER READS AS SETTLED, NOT AS OWING NOTHING',
  /settled/i.test(body) && !/owes GHS 0\.00/i.test(body),
  body.slice(0, 700),
);

// ---------------------------------------------------------------------------
console.log('\nPaying ahead');
await choose('#customerId', 'Serwaa');
await page.fill('#amount', '100');
await choose('#method', 'Cash');
await page.waitForTimeout(300);
await page.fill('#receivedBy', 'Kofi Mensah');
await submitPayment();
body = await text();
check(
  'it warns that nothing is owed',
  /paid ahead of an order/i.test(body),
  body.slice(0, 900),
);
await submitPayment();
body = await text();
check(
  'A NEGATIVE BALANCE IS KEPT AND NAMED, NOT CLAMPED',
  /paid GHS 100\.00 ahead/i.test(body),
  body.slice(0, 700),
);

await open('/payments');
check(
  'and the buyer moves to the paid-ahead list',
  /paid ahead/i.test(await text()),
  (await text()).slice(0, 900),
);

// ---------------------------------------------------------------------------
console.log('\nReversing a payment');
await page.locator('button:has-text("Reverse")').first().click();
await page.locator('input[name=reason]').first().waitFor({ timeout: 10000 });
await page.locator('button[type=submit]:has-text("Take it off")').first().click();
await page.waitForTimeout(2500);
check(
  'A REVERSAL WITHOUT A REASON IS REFUSED',
  /say why/i.test(await text()),
  (await text()).slice(0, 700),
);

await page.locator('input[name=reason]').first().fill('Entered twice');
await page.locator('button[type=submit]:has-text("Take it off")').first().click();
await page.waitForTimeout(3000);
check(
  'the balance goes back up',
  /reversed/i.test(await text()),
  (await text()).slice(0, 600),
);

await open('/payments');
body = await text();
check(
  'THE PAYMENT IS STILL ON THE RECORD, with why',
  /entered twice/i.test(body) && /PAY-\d{4}-\d{4}/.test(body),
  body.slice(0, 900),
);
check('and the summary counts it as reversed', /1 reversed/i.test(body), body.slice(0, 500));

// ---------------------------------------------------------------------------
console.log('\nA worker sees none of it');
await signIn(USERS.worker);
await open('/payments');
const source = await html();
check('a worker is refused outright', /access/i.test(await text()));
check(
  'and no figure or buyer reaches the page source',
  !/PAY-\d{4}-\d{4}/.test(source) && !source.includes('Serwaa') && !/GHS 450/.test(source),
  'payment detail leaked',
);
check(
  'nor is Money in in their navigation',
  (await page.locator('nav a:has-text("Money in")').count()) === 0,
);

await browser.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✕ ${f}`);
  process.exit(1);
}
