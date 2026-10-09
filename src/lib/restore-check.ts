/**
 * Restore verification — ADRAH Farms
 *
 * A BACKUP NOBODY HAS RESTORED IS NOT A BACKUP. It is a file, and a belief.
 *
 * This module decides whether a restored copy of the database is USABLE, which
 * is a different and much stronger claim than whether the restore COMPLETED.
 * `pg_restore` exiting zero means the bytes went in. It does not mean the farm
 * could open this copy tomorrow morning and run on it.
 *
 * ── WHAT A BROKEN RESTORE ACTUALLY LOOKS LIKE ──────────────────────────────
 *
 * Not an empty database — that is obvious and somebody notices. The dangerous
 * one is a restore that is almost right:
 *
 *   A table that came back empty because its dump section failed while the rest
 *   succeeded. The screens render, the totals are simply lower, and nobody can
 *   say by how much.
 *
 *   A ledger whose rows are intact but whose sums no longer hold — a flock with
 *   negative birds, a store with negative stock. Every derived figure on the
 *   farm is a sum over those ledgers, so the arithmetic is wrong everywhere at
 *   once and plausible everywhere at once.
 *
 *   A migration history that is short by one, so the restored copy is a schema
 *   version behind and the application fails on the first query touching a
 *   column that does not exist yet.
 *
 * Each of those passes "the restore completed". Each is caught below.
 *
 * ── PURE, SO IT CAN BE TESTED WITHOUT A DISASTER ───────────────────────────
 *
 * This file takes figures and returns findings. Collecting the figures from a
 * real database is the script's job. That split is what lets the checks
 * themselves be tested against a damaged copy that never existed.
 */

export type Severity = 'FATAL' | 'SERIOUS' | 'NOTE';

/**
 * A list somebody can read.
 *
 * Twenty-six migration names in one sentence is not a message, it is a wall.
 * The first few plus a count says the same thing and can be taken in at a
 * glance, which is the state the person reading this is likely to be in.
 */
export function nameList(names: string[], show = 3): string {
  if (names.length <= show) return names.join(', ');
  return `${names.slice(0, show).join(', ')} and ${names.length - show} more`;
}

export interface Finding {
  severity: Severity;
  /** What is wrong, in one sentence somebody can act on. */
  message: string;
  /** What it means for the farm if this is ignored. */
  consequence?: string;
}

// ---------------------------------------------------------------------------
// WHAT THE SCRIPT COLLECTS
// ---------------------------------------------------------------------------

export interface TableCount {
  table: string;
  source: number;
  restored: number;
}

export interface LedgerBalance {
  /** A flock code, or an item and location — whatever names the thing. */
  subject: string;
  balance: number;
}

export interface BatchDrift {
  subject: string;
  /** Sum over movements at the location. */
  locationTotal: number;
  /** Sum over movements that carry a batch. */
  batchedTotal: number;
}

export interface RestoreFacts {
  /** Every table, with its row count on each side. */
  tables: TableCount[];
  /** Migrations recorded in the source, and in the restored copy. */
  sourceMigrations: string[];
  restoredMigrations: string[];
  /** Migration folders present in the repository. */
  localMigrations: string[];
  /** Population per flock, derived from the restored ledger. */
  populations: LedgerBalance[];
  /** Stock on hand per item per location, derived from the restored ledger. */
  stockLevels: LedgerBalance[];
  /** Where a location's total and its batch totals disagree. */
  batchDrift: BatchDrift[];
  /** Rows whose foreign key points at something that is not there. */
  orphans: { table: string; column: string; count: number }[];
  /** How long the restore itself took, in seconds. */
  restoreSeconds: number;
  /** Size of the dump, in bytes. A suspiciously small one is worth saying. */
  dumpBytes: number;
}

// ---------------------------------------------------------------------------
// THE CHECKS
// ---------------------------------------------------------------------------

/**
 * TABLES THAT CAME BACK SHORT.
 *
 * Compared against the source, not against a remembered number. A table that
 * lost rows is FATAL even when it lost few: there is no such thing as an
 * acceptable number of missing production records, and a restore that drops
 * three rows today drops three hundred on a worse day.
 *
 * A table with MORE rows is reported too, and is just as wrong — it means the
 * restore went into a database that was not empty, which is how a drill
 * silently becomes a merge.
 */
export function checkTables(tables: TableCount[]): Finding[] {
  const findings: Finding[] = [];

  for (const t of tables) {
    if (t.restored === t.source) continue;

    if (t.source > 0 && t.restored === 0) {
      findings.push({
        severity: 'FATAL',
        message: `${t.table} is EMPTY in the restored copy — ${t.source} rows did not come back.`,
        consequence:
          'Every figure derived from this table would read zero, and the screens would render as though the farm had never recorded anything.',
      });
    } else if (t.restored < t.source) {
      findings.push({
        severity: 'FATAL',
        message: `${t.table} is short by ${t.source - t.restored} of ${t.source} rows.`,
        consequence: 'A partial table is worse than an empty one: the totals look plausible.',
      });
    } else {
      findings.push({
        severity: 'FATAL',
        message: `${t.table} has ${t.restored - t.source} MORE rows than the source.`,
        consequence:
          'The restore went into a database that was not empty. This is a merge, not a restore, and the result belongs to neither copy.',
      });
    }
  }

  return findings;
}

/**
 * THE MIGRATION HISTORY.
 *
 * Three lists have to agree: what the repository holds, what the source has
 * applied, and what came back. A restored copy one migration behind fails on
 * the first query touching a column that does not exist yet — which, in this
 * application, is the dashboard.
 */
export function checkMigrations(facts: RestoreFacts): Finding[] {
  const findings: Finding[] = [];
  const restored = new Set(facts.restoredMigrations);
  const source = new Set(facts.sourceMigrations);

  /**
   * NO MIGRATION HISTORY AT ALL.
   *
   * The schema was pushed rather than migrated. Everything may work today, and
   * the copy still cannot be rebuilt from the repository — which is precisely
   * what a restore onto fresh hardware has to do.
   */
  if (facts.sourceMigrations.length === 0 && facts.localMigrations.length > 0) {
    findings.push({
      severity: 'SERIOUS',
      message: 'The live database has no migration history at all.',
      consequence:
        'Its schema was pushed rather than migrated, so it cannot be rebuilt from the repository on fresh hardware — which is exactly what a real restore has to do.',
    });
    return findings;
  }

  const lost = facts.sourceMigrations.filter((m) => !restored.has(m));
  if (lost.length > 0) {
    findings.push({
      severity: 'FATAL',
      message: `The restored copy is missing ${lost.length} migration record(s): ${nameList(lost)}.`,
      consequence: 'The application will fail on the first query that touches a newer column.',
    });
  }

  const pending = facts.localMigrations.filter((m) => !source.has(m));
  if (pending.length > 0) {
    findings.push({
      severity: 'SERIOUS',
      message: `The LIVE database has not applied ${pending.length} migration(s) that the repository holds: ${nameList(pending)}.`,
      consequence:
        'This is not a restore problem — the live database is behind the code. Run the deploy before anything else.',
    });
  }

  const orphaned = facts.sourceMigrations.filter((m) => !facts.localMigrations.includes(m));
  if (orphaned.length > 0) {
    findings.push({
      severity: 'SERIOUS',
      message: `The live database records ${orphaned.length} migration(s) with no folder in the repository: ${nameList(orphaned)}.`,
      consequence:
        'A future restore onto a clean database cannot reproduce this schema from the repository alone.',
    });
  }

  return findings;
}

/**
 * LEDGERS THAT NO LONGER ADD UP.
 *
 * Population and stock are derived by summing an append-only ledger, so a
 * negative total is not a number that is slightly off — it is proof that rows
 * are missing, because no sequence of real events can take a flock below zero
 * birds. The writers refuse it; only a damaged copy can produce it.
 */
export function checkLedgers(facts: RestoreFacts): Finding[] {
  const findings: Finding[] = [];

  for (const flock of facts.populations.filter((p) => p.balance < 0)) {
    findings.push({
      severity: 'FATAL',
      message: `Flock ${flock.subject} has a population of ${flock.balance} in the restored copy.`,
      consequence:
        'No sequence of real events produces negative birds — placement rows are missing from the ledger.',
    });
  }

  for (const stock of facts.stockLevels.filter((s) => s.balance < 0)) {
    findings.push({
      severity: 'FATAL',
      message: `${stock.subject} holds ${stock.balance} in the restored copy.`,
      consequence: 'Receipts are missing from the stock ledger; the issues against them survived.',
    });
  }

  /**
   * AND THE INVARIANT THE STOCK TAKE ESTABLISHED: what a location holds must
   * equal what its batches hold, or there is stock that FEFO can never select
   * and dispatch can never send.
   */
  for (const drift of facts.batchDrift) {
    findings.push({
      severity: 'SERIOUS',
      message: `${drift.subject}: the location holds ${drift.locationTotal} but its batches hold ${drift.batchedTotal}.`,
      consequence:
        'The difference is stock that appears on every report and can never be dispatched.',
    });
  }

  return findings;
}

/**
 * ROWS POINTING AT NOTHING.
 *
 * Foreign keys should make this impossible, and in a clean restore they do.
 * It is checked anyway because a restore done with constraints disabled — which
 * is how a large one is often made to finish — can leave them behind, and
 * nothing re-validates them afterwards unless somebody asks.
 */
export function checkOrphans(facts: RestoreFacts): Finding[] {
  return facts.orphans
    .filter((o) => o.count > 0)
    .map((o) => ({
      severity: 'FATAL' as const,
      message: `${o.count} row(s) in ${o.table} point at a ${o.column} that is not there.`,
      consequence:
        'The restore was made with constraints disabled and nothing revalidated them afterwards.',
    }));
}

/** Things worth saying that are not failures. */
export function checkShape(facts: RestoreFacts): Finding[] {
  const findings: Finding[] = [];

  /**
   * AN EMPTY DATABASE RESTORES PERFECTLY.
   *
   * Every ledger adds up, every table matches, nothing is missing — because
   * there was nothing there. That is a true result and a misleading headline,
   * and before a farm has placed its first bird it is also the expected one.
   * Said plainly so a passing drill today is not mistaken for a passing drill
   * once there is something to lose.
   */
  const totalRows = facts.tables.reduce((sum, t) => sum + t.source, 0);
  if (totalRows === 0) {
    findings.push({
      severity: 'SERIOUS',
      message: 'There is no data in this database yet — every table is empty.',
      consequence:
        'The drill has proved the mechanism works, not that your records survive it. Run it again once the farm is recording.',
    });
  }

  if (facts.dumpBytes < 50_000) {
    findings.push({
      severity: 'SERIOUS',
      message: `The dump is only ${Math.round(facts.dumpBytes / 1024)} KB.`,
      consequence:
        'That is small enough to be a schema with no data in it. Check the dump command actually included the rows.',
    });
  }

  if (facts.restoreSeconds > 600) {
    findings.push({
      severity: 'NOTE',
      message: `The restore took ${Math.round(facts.restoreSeconds / 60)} minutes.`,
      consequence:
        'That is how long the farm would be down. Worth knowing before the day it matters.',
    });
  }

  return findings;
}

export function verify(facts: RestoreFacts): Finding[] {
  return [
    ...checkTables(facts.tables),
    ...checkMigrations(facts),
    ...checkLedgers(facts),
    ...checkOrphans(facts),
    ...checkShape(facts),
  ];
}

// ---------------------------------------------------------------------------
// THE VERDICT
// ---------------------------------------------------------------------------

export type Verdict = 'USABLE' | 'USABLE_WITH_PROBLEMS' | 'NOT_USABLE';

export function verdictOf(findings: Finding[]): Verdict {
  if (findings.some((f) => f.severity === 'FATAL')) return 'NOT_USABLE';
  if (findings.some((f) => f.severity === 'SERIOUS')) return 'USABLE_WITH_PROBLEMS';
  return 'USABLE';
}

/**
 * What the drill says at the end.
 *
 * WRITTEN FOR SOMEBODY WHO IS NOT A DEVELOPER, because the person who runs this
 * at seven in the morning after a bad night may not be one. It says what was
 * proved, and — the part that matters more — what was not.
 */
export function verdictSentence(verdict: Verdict, facts: RestoreFacts): string {
  const rows = facts.tables.reduce((sum, t) => sum + t.restored, 0).toLocaleString('en-GH');

  switch (verdict) {
    case 'USABLE':
      return (
        `The backup restores and the restored copy is coherent: ${rows} rows across ` +
        `${facts.tables.length} tables, every ledger adds up, and the schema is the one the code expects. ` +
        `It took ${Math.round(facts.restoreSeconds)}s, which is roughly how long the farm would be down.`
      );
    case 'USABLE_WITH_PROBLEMS':
      return (
        'The backup restores and nothing is missing, but something below needs attention ' +
        'before this copy could be relied on. Read the SERIOUS lines.'
      );
    case 'NOT_USABLE':
      return (
        'THIS BACKUP WOULD NOT HAVE SAVED THE FARM. Something came back wrong, and the ' +
        'lines below say what. Fix it now, while it is a drill.'
      );
  }
}

/**
 * The one sentence this drill must always end on.
 *
 * SAYING WHAT IT DOES NOT PROVE is the difference between a drill and a false
 * sense of safety. A restore verified here is a restore of the data as it was
 * at the moment of the dump — it says nothing about everything recorded since.
 */
export function limitsNote(): string {
  return (
    'What this does NOT prove: that a backup taken at any OTHER moment is good, that the ' +
    'hosted database can be rolled back to a point in time, or that anybody knows how to ' +
    'do this under pressure. It proves one dump, taken now, restores into a coherent copy. ' +
    'Running it on a schedule is what turns that into confidence.'
  );
}
