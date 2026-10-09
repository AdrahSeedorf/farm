import { describe, expect, it } from 'vitest';
import {
  checkLedgers,
  checkMigrations,
  checkOrphans,
  checkShape,
  checkTables,
  limitsNote,
  verdictOf,
  verdictSentence,
  nameList,
  verify,
  type RestoreFacts,
} from '@/lib/restore-check';

const facts = (over: Partial<RestoreFacts> = {}): RestoreFacts => ({
  tables: [
    { table: 'AnimalGroup', source: 3, restored: 3 },
    { table: 'ProductionRecord', source: 420, restored: 420 },
    { table: 'StockMovement', source: 1200, restored: 1200 },
  ],
  sourceMigrations: ['20260815113253_first', '20261001140000_lighting'],
  restoredMigrations: ['20260815113253_first', '20261001140000_lighting'],
  localMigrations: ['20260815113253_first', '20261001140000_lighting'],
  populations: [{ subject: 'FLK-1', balance: 994 }],
  stockLevels: [{ subject: 'Layer mash in Farm Store', balance: 250 }],
  batchDrift: [],
  orphans: [],
  restoreSeconds: 12,
  dumpBytes: 4_200_000,
  ...over,
});

describe('a clean restore', () => {
  it('finds nothing wrong', () => {
    expect(verify(facts())).toEqual([]);
  });

  it('and the verdict says what was proved, including how long it took', () => {
    const sentence = verdictSentence('USABLE', facts());
    expect(sentence).toMatch(/1,623 rows/);
    expect(sentence).toMatch(/every ledger adds up/);
    expect(sentence).toMatch(/12s/);
  });
});

/**
 * THE DANGEROUS CASE IS NOT AN EMPTY DATABASE. That is obvious and somebody
 * notices. It is a restore that is ALMOST right.
 */
describe('tables that came back short', () => {
  it('calls an empty table fatal, and says what it would do to the screens', () => {
    const found = checkTables([{ table: 'ProductionRecord', source: 420, restored: 0 }]);
    expect(found[0].severity).toBe('FATAL');
    expect(found[0].message).toMatch(/EMPTY/);
    expect(found[0].consequence).toMatch(/as though the farm had never recorded anything/);
  });

  it('calls a PARTIAL table fatal too, and says why it is worse', () => {
    // Three missing production records do not look like a disaster. That is the
    // problem: the totals stay plausible.
    const found = checkTables([{ table: 'ProductionRecord', source: 420, restored: 417 }]);
    expect(found[0].severity).toBe('FATAL');
    expect(found[0].message).toMatch(/short by 3 of 420/);
    expect(found[0].consequence).toMatch(/the totals look plausible/);
  });

  it('catches a restore into a database that was NOT empty', () => {
    // More rows than the source is a merge wearing a restore's clothes, and the
    // result belongs to neither copy.
    const found = checkTables([{ table: 'Customer', source: 10, restored: 14 }]);
    expect(found[0].severity).toBe('FATAL');
    expect(found[0].message).toMatch(/4 MORE rows/);
    expect(found[0].consequence).toMatch(/merge, not a restore/);
  });

  it('says nothing about a table that matches', () => {
    expect(checkTables([{ table: 'Site', source: 1, restored: 1 }])).toEqual([]);
  });

  it('is not fooled by two tables that are wrong in opposite directions', () => {
    const found = checkTables([
      { table: 'A', source: 10, restored: 8 },
      { table: 'B', source: 10, restored: 12 },
    ]);
    expect(found).toHaveLength(2);
  });
});

describe('the migration history', () => {
  it('is fatal when the restored copy is a migration behind', () => {
    const found = checkMigrations(
      facts({ restoredMigrations: ['20260815113253_first'] }),
    );
    expect(found[0].severity).toBe('FATAL');
    expect(found[0].consequence).toMatch(/fail on the first query/);
  });

  it('separately reports a LIVE database behind the repository', () => {
    // Not a restore problem at all, and saying so saves an hour of looking in
    // the wrong place.
    const found = checkMigrations(
      facts({
        localMigrations: ['20260815113253_first', '20261001140000_lighting', '20261010_new'],
      }),
    );
    expect(found[0].severity).toBe('SERIOUS');
    expect(found[0].consequence).toMatch(/not a restore problem/);
  });

  it('catches a migration recorded live with no folder in the repository', () => {
    // Exactly the state a duplicate migration left behind once already.
    const found = checkMigrations(
      facts({
        sourceMigrations: ['20260815113253_first', '20261001140000_lighting', '20260911_ghost'],
        restoredMigrations: ['20260815113253_first', '20261001140000_lighting', '20260911_ghost'],
      }),
    );
    expect(found.some((f) => /no folder in the repository/.test(f.message))).toBe(true);
    expect(found.some((f) => /cannot reproduce this schema/.test(f.consequence ?? ''))).toBe(true);
  });
});

describe('ledgers that no longer add up', () => {
  /**
   * A negative population is not a figure that is slightly off. The writers
   * refuse to take a flock below zero, so only a damaged copy can produce one —
   * which makes it proof that rows are missing rather than a hint.
   */
  it('treats a negative population as proof of missing rows', () => {
    const found = checkLedgers(facts({ populations: [{ subject: 'FLK-1', balance: -40 }] }));
    expect(found[0].severity).toBe('FATAL');
    expect(found[0].consequence).toMatch(/No sequence of real events/);
  });

  it('treats negative stock the same way', () => {
    const found = checkLedgers(
      facts({ stockLevels: [{ subject: 'Layer mash in Farm Store', balance: -50 }] }),
    );
    expect(found[0].severity).toBe('FATAL');
    expect(found[0].consequence).toMatch(/Receipts are missing/);
  });

  it('catches batch totals drifting from the location total', () => {
    const found = checkLedgers(
      facts({
        batchDrift: [
          { subject: 'Eggs — large in Farm Store', locationTotal: 90, batchedTotal: 60 },
        ],
      }),
    );
    expect(found[0].severity).toBe('SERIOUS');
    expect(found[0].consequence).toMatch(/can never be dispatched/);
  });

  it('says nothing about a healthy ledger', () => {
    expect(checkLedgers(facts())).toEqual([]);
  });
});

describe('rows pointing at nothing', () => {
  it('is fatal, and names the likely cause', () => {
    const found = checkOrphans(
      facts({ orphans: [{ table: 'ProductionLine', column: 'productionRecordId', count: 7 }] }),
    );
    expect(found[0].severity).toBe('FATAL');
    expect(found[0].consequence).toMatch(/constraints disabled/);
  });

  it('ignores a zero count rather than reporting a clean check as a finding', () => {
    expect(checkOrphans(facts({ orphans: [{ table: 'X', column: 'y', count: 0 }] }))).toEqual([]);
  });
});

describe('the shape of the dump', () => {
  it('questions a dump small enough to be a schema with no data', () => {
    const found = checkShape(facts({ dumpBytes: 20_000 }));
    expect(found[0].severity).toBe('SERIOUS');
    expect(found[0].consequence).toMatch(/schema with no data/);
  });

  it('reports a long restore as how long the farm would be down', () => {
    const found = checkShape(facts({ restoreSeconds: 1800 }));
    expect(found[0].severity).toBe('NOTE');
    expect(found[0].consequence).toMatch(/how long the farm would be down/);
  });

  it('a slow restore does not by itself make a backup unusable', () => {
    expect(verdictOf(checkShape(facts({ restoreSeconds: 1800 })))).toBe('USABLE');
  });
});

describe('the verdict', () => {
  it('is NOT_USABLE on anything fatal', () => {
    expect(verdictOf([{ severity: 'FATAL', message: 'x' }])).toBe('NOT_USABLE');
  });

  it('is USABLE_WITH_PROBLEMS on something serious', () => {
    expect(verdictOf([{ severity: 'SERIOUS', message: 'x' }])).toBe('USABLE_WITH_PROBLEMS');
  });

  it('is USABLE when nothing was found', () => {
    expect(verdictOf([])).toBe('USABLE');
  });

  it('a fatal finding outranks a note, whatever order they arrive in', () => {
    expect(
      verdictOf([
        { severity: 'NOTE', message: 'a' },
        { severity: 'FATAL', message: 'b' },
      ]),
    ).toBe('NOT_USABLE');
  });

  it('says plainly when the backup would not have saved the farm', () => {
    const sentence = verdictSentence('NOT_USABLE', facts());
    expect(sentence).toMatch(/WOULD NOT HAVE SAVED THE FARM/);
    expect(sentence).toMatch(/while it is a drill/);
  });
});

/**
 * SAYING WHAT IT DOES NOT PROVE is the difference between a drill and a false
 * sense of safety.
 */
describe('the limits', () => {
  it('names the three things a passing drill does not establish', () => {
    const note = limitsNote();
    expect(note).toMatch(/any OTHER moment/);
    expect(note).toMatch(/point in time/);
    expect(note).toMatch(/under pressure/);
  });

  it('and does not let a single pass read as confidence', () => {
    expect(limitsNote()).toMatch(/on a schedule/);
  });
});

describe('messages somebody can actually read', () => {
  it('truncates a long list of names rather than printing a wall', () => {
    // Twenty-six migration names in one sentence is not a message.
    const found = checkMigrations(
      facts({
        localMigrations: ['a', 'b', 'c', 'd', 'e', 'f'],
        sourceMigrations: ['a'],
        restoredMigrations: ['a'],
      }),
    );
    expect(found[0].message).toMatch(/and 2 more/);
    expect(found[0].message).not.toMatch(/f,/);
  });

  it('prints a short list in full', () => {
    expect(nameList(['a', 'b'])).toBe('a, b');
  });

  /**
   * "No migration history at all" explains every per-migration difference, so
   * listing them underneath it is noise on top of the finding that matters.
   */
  it('says the schema was pushed INSTEAD OF listing every missing migration', () => {
    const found = checkMigrations(
      facts({ sourceMigrations: [], restoredMigrations: [], localMigrations: ['a', 'b', 'c'] }),
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/no migration history at all/);
  });
});

/**
 * AN EMPTY DATABASE RESTORES PERFECTLY, because there is nothing to lose. True,
 * and a misleading headline — and before the first bird is placed it is also
 * the expected result.
 */
describe('a database with nothing in it yet', () => {
  const empty = facts({
    tables: [
      { table: 'AnimalGroup', source: 0, restored: 0 },
      { table: 'StockMovement', source: 0, restored: 0 },
    ],
    populations: [],
    stockLevels: [],
  });

  it('does not let an empty database read as a passing drill', () => {
    const found = verify(empty);
    expect(found.some((f) => /no data in this database yet/.test(f.message))).toBe(true);
    expect(verdictOf(found)).toBe('USABLE_WITH_PROBLEMS');
  });

  it('and says what it HAS proved, rather than only what it has not', () => {
    const found = verify(empty).find((f) => /no data/.test(f.message))!;
    expect(found.consequence).toMatch(/proved the mechanism works/);
    expect(found.consequence).toMatch(/Run it again once the farm is recording/);
  });
});
