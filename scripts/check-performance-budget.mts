/**
 * The marketing pages' performance budget, as a check rather than a promise.
 *
 * WHY THIS IS A SCRIPT AND NOT A NOTE IN A DOCUMENT
 *   The specification calls the budget non-negotiable, and a non-negotiable
 *   number that nobody measures is a number that quietly stops being true. It
 *   does not break loudly: somebody adds one client component to the footer, the
 *   pages get 40 KB heavier, and the only person who finds out is a customer in
 *   New Edubiase who gave up waiting. This turns that into a failing command.
 *
 * WHAT IT MEASURES
 *   What a first-time visitor actually downloads, gzipped, with an empty cache —
 *   which is the figure the budget is written against. The production server
 *   here may not compress; the CDN in front of it will, so the bytes are
 *   compressed locally before being counted rather than trusted to the wire.
 *
 * HOW TO RUN IT
 *   npm run build && npm start        (in one terminal)
 *   npm run perf:budget               (in another)
 */
import { chromium } from 'playwright';
import { gzipSync } from 'node:zlib';

const BASE = process.env.PERF_BASE ?? 'http://127.0.0.1:3000';

/** Public pages only. The office is a different budget for a different network. */
const PAGES = ['/', '/about', '/products', '/quality', '/wholesale', '/contact'];

/**
 * From the specification, section 8. JavaScript is the one that matters: HTML
 * and CSS are recoverable, and a phone that has downloaded 400 KB of script has
 * also had to parse and run it.
 */
const BUDGET = {
  scriptKb: 150,
  /** Everything else together — html, css, fonts, images above the fold. */
  totalKb: 400,
};

type Kind = 'document' | 'script' | 'stylesheet' | 'font' | 'image';
const KINDS: Kind[] = ['document', 'script', 'stylesheet', 'font', 'image'];

const executablePath = process.env.CHROMIUM_PATH ?? undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});

const failures: string[] = [];
const rows: { path: string; totals: Record<Kind, number> }[] = [];

for (const path of PAGES) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const seen = new Map<string, { kind: Kind; bytes: number }>();

  page.on('response', async (res) => {
    const kind = res.request().resourceType() as Kind;
    if (!KINDS.includes(kind)) return;
    try {
      seen.set(res.url(), { kind, bytes: gzipSync(await res.body()).length });
    } catch {
      // Redirects and aborted requests have no body to weigh.
    }
  });

  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });

  const totals = { document: 0, script: 0, stylesheet: 0, font: 0, image: 0 };
  for (const { kind, bytes } of seen.values()) totals[kind] += bytes;
  rows.push({ path, totals });

  const scriptKb = totals.script / 1024;
  const totalKb = KINDS.reduce((sum, k) => sum + totals[k], 0) / 1024;

  if (scriptKb > BUDGET.scriptKb) {
    failures.push(
      `${path} ships ${scriptKb.toFixed(1)} KB of JavaScript, over the ${BUDGET.scriptKb} KB budget.`,
    );
  }
  if (totalKb > BUDGET.totalKb) {
    failures.push(
      `${path} weighs ${totalKb.toFixed(1)} KB in total, over the ${BUDGET.totalKb} KB budget.`,
    );
  }

  await context.close();
}

await browser.close();

const kb = (n: number) => (n / 1024).toFixed(1).padStart(6);
console.log('\nWhat a first-time visitor downloads, gzipped (KB)\n');
console.log('page          html      js     css   images     all');
for (const { path, totals } of rows) {
  const all = KINDS.reduce((sum, k) => sum + totals[k], 0);
  console.log(
    `${path.padEnd(12)}${kb(totals.document)}  ${kb(totals.script)}  ${kb(
      totals.stylesheet,
    )}  ${kb(totals.image)}  ${kb(all)}`,
  );
}

const worstScript = Math.max(...rows.map((r) => r.totals.script)) / 1024;
console.log(
  `\nJavaScript, worst page: ${worstScript.toFixed(1)} KB of ${BUDGET.scriptKb} KB — ` +
    `${(BUDGET.scriptKb - worstScript).toFixed(1)} KB spare.`,
);

if (failures.length > 0) {
  console.error('\nOver budget:');
  for (const f of failures) console.error(`  ✕ ${f}`);
  process.exit(1);
}

// A WARNING, NOT A FAILURE. Almost all of the figure above is the React and
// Next runtime, which arrives whether the page uses it or not. The thin margin
// is worth knowing about before somebody spends it on a date picker.
if (worstScript > BUDGET.scriptKb * 0.9) {
  console.warn(
    `\n⚠ Within 10% of the budget. Nearly all of it is framework rather than this\n` +
      `  application's code, so the next client component added to a public page is\n` +
      `  likely to be what breaks it. Prefer a server component or plain HTML.`,
  );
}
console.log('\nWithin budget.\n');
