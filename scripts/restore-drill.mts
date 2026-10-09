import '../src/lib/load-env';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  limitsNote,
  verdictOf,
  verdictSentence,
  verify,
  type BatchDrift,
  type Finding,
  type LedgerBalance,
  type RestoreFacts,
  type TableCount,
} from '../src/lib/restore-check';

/**
 * The restore drill — ADRAH Farms
 *
 *   npm run restore:drill
 *   npm run restore:drill -- --keep          (leave the restored copy to look at)
 *   npm run restore:drill -- --target postgresql://...  (restore somewhere else)
 *
 * A BACKUP NOBODY HAS RESTORED IS NOT A BACKUP. It is a file, and a belief.
 *
 * This takes a dump of the live database, restores it into a scratch database,
 * and then checks whether the restored copy is USABLE — not merely whether the
 * restore completed. `pg_restore` exiting zero only means the bytes went in.
 *
 * ── IT NEVER WRITES TO THE LIVE DATABASE ───────────────────────────────────
 *
 * The only thing it does to the source is `pg_dump`, which is a read. The
 * restore goes into a database whose name this script generates, on a server
 * the caller names, and it REFUSES to proceed if the target resolves to the
 * same database as the source. That refusal is the most important line in the
 * file: a drill that restores over production is the disaster it was meant to
 * rehearse for.
 *
 * ── WHY A LOGICAL DUMP, WHEN THE HOST HAS SNAPSHOTS ────────────────────────
 *
 * Neon keeps its own point-in-time history, and that is good. It is also the
 * same company holding the thing it is backing up. A `pg_dump` on disk is a
 * copy this farm owns, restorable onto any Postgres anywhere, including after
 * leaving the host entirely. The two are not alternatives.
 */

// ---------------------------------------------------------------------------
// ARGUMENTS AND SAFETY
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const targetIndex = args.indexOf('--target');
const targetBase = targetIndex === -1 ? undefined : args[targetIndex + 1];

const source = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!source) {
  console.error('DATABASE_URL is not set. Check your .env.');
  process.exit(1);
}

/** Host and database, for comparing two URLs without printing a password. */
function identity(url: string): string {
  const u = new URL(url);
  return `${u.hostname}${u.pathname}`;
}

const scratchName = `adrah_drill_${Date.now()}`;

/**
 * Where the restore goes.
 *
 * Defaults to the SAME SERVER as the source with a generated database name,
 * because that is the only server we can be sure exists — but never the same
 * database. Pass `--target` to restore onto a local Postgres instead, which is
 * the better drill: it proves the dump is portable off the host.
 */
const targetServer = targetBase ?? source;
const target = (() => {
  const u = new URL(targetServer);
  u.pathname = `/${scratchName}`;
  return u.toString();
})();

const adminUrl = (() => {
  const u = new URL(targetServer);
  u.pathname = '/postgres';
  return u.toString();
})();

if (identity(target) === identity(source)) {
  console.error('\n  REFUSING TO RUN.\n');
  console.error('  The restore target is the same database as the source. A drill that');
  console.error('  restores over production is the disaster it was meant to rehearse for.\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// RUNNING THINGS
// ---------------------------------------------------------------------------

function run(command: string, commandArgs: string[], label: string): string {
  try {
    return execFileSync(command, commandArgs, {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const e = error as { stderr?: string; message: string; code?: string };
    console.error(`\n  ${label} failed:\n`);
    console.error(`  ${(e.stderr || e.message).trim().split('\n').slice(0, 6).join('\n  ')}\n`);
    // ONLY when the tool is genuinely absent. Printing install instructions
    // under a SQL error sends somebody off installing software they already
    // have, while the real message scrolls past.
    if (e.code === 'ENOENT') {
      console.error(`  ${command} is not installed. On macOS: brew install libpq, then add`);
      console.error('  its bin directory to PATH. On Ubuntu: apt install postgresql-client\n');
    }
    process.exit(1);
  }
}

const query = (url: string, sql: string): string[][] =>
  run('psql', [url, '-q', '-t', '-A', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-c', sql], 'psql')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t'));

const scalar = (url: string, sql: string): string => query(url, sql)[0]?.[0] ?? '';

// ---------------------------------------------------------------------------
// THE DRILL
// ---------------------------------------------------------------------------

console.log('\n  ADRAH Farms — restore drill\n');
console.log(`  Source : ${identity(source)}  (read only)`);
console.log(`  Target : ${identity(target)}\n`);

const workDir = mkdtempSync(join(tmpdir(), 'adrah-drill-'));
const dumpPath = join(workDir, 'adrah.dump');

console.log('  Taking a dump of the live database…');
run(
  'pg_dump',
  ['--format=custom', '--no-owner', '--no-privileges', '--file', dumpPath, source],
  'pg_dump',
);
const dumpBytes = statSync(dumpPath).size;
console.log(`  ${(dumpBytes / 1_048_576).toFixed(1)} MB written.\n`);

console.log(`  Creating ${scratchName}…`);
run('psql', [adminUrl, '-q', '-c', `CREATE DATABASE "${scratchName}"`], 'CREATE DATABASE');

console.log('  Restoring…');
const startedAt = Date.now();
// `--exit-on-error` is deliberate: a restore that reports errors and carries on
// is exactly the "almost right" copy this drill exists to catch.
run('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', target, dumpPath], 'pg_restore');
const restoreSeconds = (Date.now() - startedAt) / 1000;
console.log(`  Restored in ${restoreSeconds.toFixed(1)}s.\n`);

console.log('  Checking whether the copy is usable…\n');

// --- row counts, both sides -------------------------------------------------
const TABLE_LIST = `
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name
`;
const countsOf = (url: string): Map<string, number> => {
  const names = query(url, TABLE_LIST).map((r) => r[0]);
  // One query, not one per table: a hundred round trips to a hosted database
  // is slower than the restore it is checking.
  const union = names
    .map((n) => `SELECT '${n}' AS t, count(*) AS c FROM "${n}"`)
    .join(' UNION ALL ');
  return new Map(query(url, union).map((r) => [r[0], Number(r[1])]));
};

const sourceCounts = countsOf(source);
const restoredCounts = countsOf(target);
const tables: TableCount[] = [...sourceCounts.keys()]
  .filter((t) => t !== '_prisma_migrations')
  .map((t) => ({
    table: t,
    source: sourceCounts.get(t) ?? 0,
    restored: restoredCounts.get(t) ?? 0,
  }));

// --- migrations -------------------------------------------------------------
/**
 * A DATABASE WITH NO MIGRATION TABLE IS A REAL STATE, not a crash.
 *
 * It means the schema was pushed rather than migrated — `prisma db push`, or a
 * hand-built copy. The drill reports that as a finding, because a database with
 * no migration history cannot be rebuilt from the repository and the farm
 * should know. Dying here instead would have hidden it behind a stack trace.
 */
const migrationsOf = (url: string): string[] => {
  const exists = scalar(url, `SELECT to_regclass('public._prisma_migrations') IS NOT NULL`);
  if (exists !== 't') return [];
  return query(
    url,
    `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`,
  ).map((r) => r[0]);
};

const localMigrations = readdirSync('prisma/migrations')
  .filter((name) => statSync(join('prisma/migrations', name)).isDirectory())
  .sort();

// --- the ledgers, derived from the RESTORED copy ----------------------------
const populations: LedgerBalance[] = query(
  target,
  `SELECT g.code, COALESCE(sum(e.delta), 0)
     FROM "AnimalGroup" g
     LEFT JOIN "AnimalGroupEvent" e ON e."animalGroupId" = g.id
    GROUP BY g.code`,
).map((r) => ({ subject: r[0], balance: Number(r[1]) }));

const stockLevels: LedgerBalance[] = query(
  target,
  `SELECT i.name || ' in ' || l.name, sum(m."deltaBase")
     FROM "StockMovement" m
     JOIN "Item" i ON i.id = m."itemId"
     JOIN "StockLocation" l ON l.id = m."stockLocationId"
    GROUP BY i.name, l.name`,
).map((r) => ({ subject: r[0], balance: Number(r[1]) }));

/**
 * The invariant the stock take established: a location's total must equal the
 * sum of its batches, or there is stock that FEFO can never select.
 *
 * Unbatched adjustments are legitimate, so this compares only items that have
 * batches at all, and reports a difference rather than assuming one is wrong.
 */
const batchDrift: BatchDrift[] = query(
  target,
  `WITH totals AS (
     SELECT m."itemId", m."stockLocationId",
            sum(m."deltaBase") AS location_total,
            sum(m."deltaBase") FILTER (WHERE m."itemBatchId" IS NOT NULL) AS batched_total
       FROM "StockMovement" m
      GROUP BY m."itemId", m."stockLocationId"
   )
   SELECT i.name || ' in ' || l.name, t.location_total, COALESCE(t.batched_total, 0)
     FROM totals t
     JOIN "Item" i ON i.id = t."itemId"
     JOIN "StockLocation" l ON l.id = t."stockLocationId"
    WHERE t.batched_total IS NOT NULL
      AND t.location_total <> t.batched_total`,
).map((r) => ({
  subject: r[0],
  locationTotal: Number(r[1]),
  batchedTotal: Number(r[2]),
}));

/**
 * Rows pointing at nothing.
 *
 * Asked of the database's own constraint catalogue rather than hand-written per
 * table, so it keeps working as the schema grows. Postgres revalidates each
 * foreign key; anything it refuses is an orphan a disabled-constraint restore
 * left behind.
 */
const orphanRows = query(
  target,
  `SELECT conrelid::regclass::text, conname
     FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace
    ORDER BY 1`,
);
const orphans: { table: string; column: string; count: number }[] = [];
for (const [table, constraint] of orphanRows) {
  try {
    execFileSync(
      'psql',
      [target, '-q', '-v', 'ON_ERROR_STOP=1', '-c',
       `ALTER TABLE ${table} VALIDATE CONSTRAINT "${constraint}"`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch {
    orphans.push({ table: table.replace(/"/g, ''), column: constraint, count: 1 });
  }
}

const facts: RestoreFacts = {
  tables,
  sourceMigrations: migrationsOf(source),
  restoredMigrations: migrationsOf(target),
  localMigrations,
  populations,
  stockLevels,
  batchDrift,
  orphans,
  restoreSeconds,
  dumpBytes,
};

// ---------------------------------------------------------------------------
// THE VERDICT
// ---------------------------------------------------------------------------

const findings: Finding[] = verify(facts);
const verdict = verdictOf(findings);

const RULE = '  ' + '─'.repeat(72);
console.log(RULE);
console.log(`  ${verdict.replace(/_/g, ' ')}`);
console.log(RULE + '\n');
console.log(`  ${verdictSentence(verdict, facts)}\n`);

if (findings.length > 0) {
  for (const group of ['FATAL', 'SERIOUS', 'NOTE'] as const) {
    const inGroup = findings.filter((f) => f.severity === group);
    if (inGroup.length === 0) continue;
    console.log(`  ${group}`);
    for (const f of inGroup) {
      console.log(`    • ${f.message}`);
      if (f.consequence) console.log(`      ${f.consequence}`);
    }
    console.log('');
  }
}

console.log(`  ${limitsNote()}\n`);

// ---------------------------------------------------------------------------
// CLEARING UP
// ---------------------------------------------------------------------------

if (keep) {
  console.log(`  Kept: ${identity(target)}`);
  console.log(`  Dump: ${dumpPath}\n`);
} else {
  run('psql', [adminUrl, '-q', '-c', `DROP DATABASE "${scratchName}"`], 'DROP DATABASE');
  rmSync(workDir, { recursive: true, force: true });
  console.log('  Scratch database and dump removed. Pass --keep to look at them.\n');
}

process.exit(verdict === 'NOT_USABLE' ? 1 : 0);
