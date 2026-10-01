/**
 * Task 16.2 browser suite — the stock take.
 *
 * WHAT THIS IS ACTUALLY CHECKING. The stock take is the only thing in the whole
 * system that compares the records against the world, so a suite that merely
 * proved the form submits would be checking the least important half of it. The
 * assertions that matter:
 *
 *   1. A CLEAN COUNT IS RECORDED AND CHANGES NOTHING. No movement is written,
 *      and the screen says the store agreed rather than that the system was
 *      right.
 *   2. A SHORTAGE CORRECTS THE LEDGER AND COMES OUT OF THE BATCHES, oldest-dated
 *      first. The location total and the batch totals must still agree
 *      afterwards — stock that FEFO cannot select is stock that can never be
 *      sold, and it would sit on the headline figure forever.
 *   3. A SURPLUS GOES INTO A BATCH OF ITS OWN, so found stock is sellable rather
 *      than stranded.
 *   4. A VARIANCE MUST SAY WHY, and "Nobody knows" is accepted.
 *   5. A LARGE VARIANCE WARNS AND THEN SAVES. Warn, never block — refusing a
 *      surprising count does not change what is on the shelf.
 *   6. BLANK IS NOT ZERO. An item left empty is not counted and writes nothing.
 *   7. A COUNT CANNOT BE EDITED OR DELETED, and the screen says so.
 *   8. THE PERIOD REPORT STOPS CLAIMING NOBODY HAS COUNTED once somebody has.
 *   9. A WORKER CANNOT COUNT, and the storekeeper can.
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3111';
const PASSWORD = 'AdrahFarms2026';
const USERS = {
  owner: 'owner@adrahfarms.com',
  store: 'store@adrahfarms.com',
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
// SQL, idempotent, and in the repository — the suites used to depend on a
// fixture that lived on one machine, and when that machine went the suites went
// with it. Two feed batches, because a shortage that does not span batches never
// exercises FEFO.
sql(`
DELETE FROM "StockTakeLine";
DELETE FROM "StockTake";
DELETE FROM "StockMovement" WHERE "itemId" IN ('itm-feed','itm-eggs');
DELETE FROM "ItemBatch" WHERE "itemId" IN ('itm-feed','itm-eggs');

INSERT INTO "Item" (id,"organisationId",sku,name,category,"stockUomId","isPerishable","isActive","updatedAt")
SELECT 'itm-feed',(SELECT id FROM "Organisation" LIMIT 1),'FEED-LAY','Layer mash','FEED',
       (SELECT id FROM "UnitOfMeasure" WHERE key='bag_50kg'),false,true,now()
ON CONFLICT (id) DO NOTHING;

INSERT INTO "Item" (id,"organisationId",sku,name,category,"stockUomId","isPerishable","isActive","updatedAt")
SELECT 'itm-eggs',(SELECT id FROM "Organisation" LIMIT 1),'EGG-LRG','Eggs — large','FINISHED_PRODUCT',
       (SELECT id FROM "UnitOfMeasure" WHERE key='crate'),true,true,now()
ON CONFLICT (id) DO NOTHING;

INSERT INTO "ItemBatch" (id,"itemId","batchNumber","expiresOn","unitCostPesewas","receivedOn") VALUES
  ('bat-feed-a','itm-feed','FEED-A', CURRENT_DATE + 20, 48000, CURRENT_DATE - 30),
  ('bat-feed-b','itm-feed','FEED-B', CURRENT_DATE + 60, 50000, CURRENT_DATE - 5);

INSERT INTO "StockMovement" (id,"itemId","itemBatchId","stockLocationId",type,"deltaBase","enteredQuantity","enteredUomId","occurredOn","recordedById")
SELECT 'mv-a','itm-feed','bat-feed-a',(SELECT id FROM "StockLocation" LIMIT 1),'PURCHASE_RECEIPT',100,2,
       (SELECT id FROM "UnitOfMeasure" WHERE key='bag_50kg'),CURRENT_DATE-30,
       (SELECT id FROM "User" WHERE email='owner@adrahfarms.com');

INSERT INTO "StockMovement" (id,"itemId","itemBatchId","stockLocationId",type,"deltaBase","enteredQuantity","enteredUomId","occurredOn","recordedById")
SELECT 'mv-b','itm-feed','bat-feed-b',(SELECT id FROM "StockLocation" LIMIT 1),'PURCHASE_RECEIPT',150,3,
       (SELECT id FROM "UnitOfMeasure" WHERE key='bag_50kg'),CURRENT_DATE-5,
       (SELECT id FROM "User" WHERE email='owner@adrahfarms.com');
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
  await page.waitForURL(/dashboard|daily|flocks|production|health|alerts|inventory/, {
    timeout: 15000,
  });
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

const onHand = (itemId) =>
  Number(sql(`SELECT COALESCE(sum("deltaBase"),0) FROM "StockMovement" WHERE "itemId"='${itemId}';`));
const batched = (itemId) =>
  Number(
    sql(
      `SELECT COALESCE(sum("deltaBase"),0) FROM "StockMovement" WHERE "itemId"='${itemId}' AND "itemBatchId" IS NOT NULL;`,
    ),
  );
const locationId = sql(`SELECT id FROM "StockLocation" LIMIT 1;`);

/**
 * Wait for the DESTINATION, never for `main h1`.
 *
 * `page.locator('main h1').waitFor()` resolves instantly against the page you
 * have not left yet. This has cost three separate debugging sessions across
 * three suites, so every navigation here names a heading unique to where it is
 * going.
 */
/**
 * SCOPED TO THE FORM, and this cost an hour.
 *
 * `page.click('button[type=submit]')` matches the FIRST submit button on the
 * page, and the application shell puts a sign-out form in the navigation. The
 * suite was signing itself out and landing on the login page, which looks
 * exactly like a permission failure. Every submit in this file names the button
 * by its own text.
 */
const submit = () =>
  page.click('main form button[type=submit]:has-text("Save")');

const waitForHeading = (fragment) =>
  page.locator(`main h1:has-text("${fragment}")`).first().waitFor({ timeout: 20000 });

// ---------------------------------------------------------------------------
console.log('\nThe store has never been counted, and the screen says so');
await signIn(USERS.store);
await open('/inventory/counts');
let body = await text();
check('the counts screen opens', /stock counts/i.test(body), body.slice(0, 200));
check('and says the store has never been counted', /never been counted/i.test(body), body.slice(0, 400));
check('and says nothing has been counted yet', /nothing has been counted yet/i.test(body));

// ---------------------------------------------------------------------------
console.log('\nThe sheet shows what the records say');
await open(`/inventory/counts/new?location=${locationId}`);
await waitForHeading('Count');
body = await text();
check('the feed is on the sheet', /Layer mash/.test(body));
check('with the records’ figure in bags, not kilograms', /Records say\s*5\b/i.test(body), body.slice(0, 600));
check('the eggs are on it too, at zero', /Eggs/.test(body) && /Records say\s*0\b/i.test(body));
check('and nothing is counted yet', /Nothing counted yet/i.test(body));

// ---------------------------------------------------------------------------
console.log('\nA clean count is recorded and changes nothing');
const beforeClean = onHand('itm-feed');
await page.fill('#count-itm-feed', '5');
await submit();
await waitForHeading('ST-');
body = await text();
check('it saved and landed on the count', /ST-\d{4}-0001/.test(body), body.slice(0, 200));
check(
  'and says the store AGREED rather than that the system was right',
  /the store agreed with the records/i.test(body),
  body.slice(0, 500),
);
check('no movement was written', onHand('itm-feed') === beforeClean, `${onHand('itm-feed')}`);
check(
  'but the count itself is on the record',
  Number(sql(`SELECT count(*) FROM "StockTakeLine";`)) === 1,
);
check(
  'and the store no longer reads as never counted',
  !/never been counted/i.test(await (async () => {
    await open('/inventory/counts');
    return text();
  })()),
);

// ---------------------------------------------------------------------------
console.log('\nBlank is not zero');
await open(`/inventory/counts/new?location=${locationId}`);
await waitForHeading('Count');
await page.fill('#count-itm-feed', '5');
// The eggs are left empty on purpose. If blank were read as zero this would
// write an adjustment against an item nobody looked at.
await submit();
await waitForHeading('ST-');
check(
  'an item left blank is simply not on the count',
  Number(sql(`SELECT count(*) FROM "StockTakeLine" WHERE "itemId"='itm-eggs';`)) === 0,
);

// ---------------------------------------------------------------------------
console.log('\nA variance has to say why');
await open(`/inventory/counts/new?location=${locationId}`);
await waitForHeading('Count');
await page.fill('#count-itm-feed', '4');
await page.waitForSelector('#cause-itm-feed', { timeout: 5000 });
body = await text();
check('the screen asks why as soon as the number is out', /short\. Why\?/i.test(body), body.slice(0, 600));
check(
  'and offers breakage, which only explains a shortage',
  (await page.$eval('#cause-itm-feed', (el) => [...el.options].map((o) => o.textContent).join('|')))
    .toLowerCase()
    .includes('broken'),
);
check(
  '"Nobody knows" is the first real option, so the honest answer is the easy one',
  await page.$eval(
    '#cause-itm-feed',
    (el) => (el.options[1]?.textContent ?? '').toLowerCase().includes('nobody knows'),
  ),
);

await submit();
await page.waitForTimeout(1200);
body = await text();
check('saving with no reason is refused', /Say why before saving/i.test(body), body.slice(0, 500));
check('and nothing was written', Number(sql(`SELECT count(*) FROM "StockTake";`)) === 2);

// ---------------------------------------------------------------------------
console.log('\nA shortage corrects the ledger, oldest batch first');
await choose('#cause-itm-feed', 'Broken');
await submit();
await page.waitForTimeout(1200);
body = await text();
// One bag out of five is 20%, which is a lot, so it warns — and THE WARNING
// MUST SPEAK IN BAGS. The browser caught this saying "50 fewer Layer mash",
// which is the same fact stated in a way that reads like a catastrophe.
check(
  'the warning counts in bags, not kilograms',
  /1 Bag \(50 kg\) fewer/i.test(body),
  body.slice(0, 700),
);
check('and does not shout fifty at somebody who lost one bag', !/50 fewer/i.test(body));
await submit();
await waitForHeading('ST-');
body = await text();
check('the count saved', /ST-\d{4}-0003/.test(body), body.slice(0, 200));
check('and leads with what did not match', /What did not match/i.test(body));
check('naming the shortfall in bags', /-1 Bag/i.test(body), body.slice(0, 700));
check('and the reason given', /Broken or spoiled/i.test(body));

check('the ledger now says 4 bags', onHand('itm-feed') === 200, `${onHand('itm-feed')} kg`);
check(
  'THE BATCHES STILL ADD UP TO THE LOCATION — no stock FEFO cannot reach',
  batched('itm-feed') === onHand('itm-feed'),
  `batched ${batched('itm-feed')} vs total ${onHand('itm-feed')}`,
);
check(
  'and it came out of the OLDEST-DATED batch, not the newest',
  Number(
    sql(
      `SELECT COALESCE(sum("deltaBase"),0) FROM "StockMovement" WHERE "itemBatchId"='bat-feed-a' AND type='ADJUSTMENT';`,
    ),
  ) === -50,
  sql(`SELECT "itemBatchId", "deltaBase" FROM "StockMovement" WHERE type='ADJUSTMENT';`),
);
check(
  'the adjustment explains itself on the ledger',
  /Stock take ST-\d{4}-0003/.test(
    sql(`SELECT notes FROM "StockMovement" WHERE type='ADJUSTMENT' LIMIT 1;`),
  ),
);
check(
  'and points back at the count it came from',
  sql(`SELECT "sourceType" FROM "StockMovement" WHERE type='ADJUSTMENT' LIMIT 1;`) === 'StockTake',
);

// ---------------------------------------------------------------------------
console.log('\nA surplus goes into a batch of its own, so it can be sold');
await open(`/inventory/counts/new?location=${locationId}`);
await waitForHeading('Count');
await page.fill('#count-itm-eggs', '3');
await page.waitForSelector('#cause-itm-eggs', { timeout: 5000 });
body = await text();
check(
  'the records held none, so the screen says so in its own words',
  /more than the records say/i.test(body),
  body.slice(0, 600),
);
await choose('#cause-itm-eggs', 'arrived');
await submit();
await page.waitForTimeout(1200);
body = await text();
check(
  'a surplus against an empty shelf warns before it saves',
  /no Eggs/i.test(body) && /Nothing has been saved yet/i.test(body),
  body.slice(0, 700),
);
await submit();
await waitForHeading('ST-');
check('confirming saves it exactly as counted', onHand('itm-eggs') === 90, `${onHand('itm-eggs')}`);
check(
  'and the found stock is in a batch, not stranded off the batches',
  batched('itm-eggs') === onHand('itm-eggs'),
  `batched ${batched('itm-eggs')} vs total ${onHand('itm-eggs')}`,
);
check(
  'named after the count that found it',
  sql(`SELECT "batchNumber" FROM "ItemBatch" WHERE "itemId"='itm-eggs';`).startsWith('FOUND-ST-'),
);
check(
  'with no expiry, because nobody knows when found stock was produced',
  sql(`SELECT COALESCE("expiresOn"::text,'none') FROM "ItemBatch" WHERE "itemId"='itm-eggs';`) ===
    'none',
);

// ---------------------------------------------------------------------------
console.log('\nA large variance warns and then saves — warn, never block');
await open(`/inventory/counts/new?location=${locationId}`);
await waitForHeading('Count');
await page.fill('#count-itm-feed', '1');
await page.waitForSelector('#cause-itm-feed', { timeout: 5000 });
await choose('#cause-itm-feed', 'Nobody knows');
await submit();
await page.waitForTimeout(1200);
body = await text();
check('a 75% difference is warned about', /75% out/i.test(body), body.slice(0, 700));
check('in bags, again', /3 Bag \(50 kg\) fewer/i.test(body), body.slice(0, 700));
check('and the warning tells them nothing has been saved', /Nothing has been saved yet/i.test(body));
check(
  'and says the shelf is what belongs on the record',
  /what is on the shelf is what belongs on the record/i.test(body),
);
await submit();
await waitForHeading('ST-');
check('confirming saves it as counted', onHand('itm-feed') === 50, `${onHand('itm-feed')} kg`);
check(
  'and "Nobody knows" was accepted as a real answer',
  sql(`SELECT cause FROM "StockTakeLine" WHERE "itemId"='itm-feed' ORDER BY id DESC LIMIT 1;`) !==
    '',
);

// ---------------------------------------------------------------------------
console.log('\nA count cannot be unsaid');
body = await text();
check(
  'the count says plainly that it cannot be edited or deleted',
  /cannot be edited or deleted/i.test(body),
  body.slice(-400),
);
check('and tells them what to do instead', /count the store again/i.test(body));
// Scoped to the count itself. The application shell has its own controls, and a
// page-wide search for the word "edit" finds them and proves nothing.
const controls = await page.$$eval('main button, main a[href]', (els) =>
  els.map((el) => `${el.textContent} ${el.getAttribute('href') ?? ''}`).join(' | '),
);
check(
  'there is no delete, edit or reverse control on the count',
  !/delete|edit|reverse|undo/i.test(controls),
  controls,
);

// ---------------------------------------------------------------------------
console.log('\nThe period report stops claiming nobody has counted');
await signIn(USERS.owner);
await open('/reports');
body = await text();
check(
  'the report no longer says nobody has counted a store',
  !/nobody has counted a store yet/i.test(body),
  body.slice(0, 400),
);
check('it says when a store was last counted', /last counted today/i.test(body), body.slice(0, 1200));
check(
  'and STILL says the figures are the records agreeing with the records',
  /records agreeing with the records/i.test(body),
);

// ---------------------------------------------------------------------------
console.log('\nWho may count');
await signIn(USERS.worker);
await open('/inventory/counts/new');
body = await text();
check('a worker cannot count a store', /access/i.test(body), body.slice(0, 300));

await signIn(USERS.store);
await open('/inventory/counts/new');
check(
  'the storekeeper can',
  !/access/i.test(await text()),
);

await browser.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✕ ${f}`);
  process.exit(1);
}
