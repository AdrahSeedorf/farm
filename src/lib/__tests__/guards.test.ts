import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard audit — ADRAH Farms
 *
 * A TEST THAT READS THE SOURCE, not the behaviour.
 *
 * Every other test in this suite proves that a function does the right thing
 * when it is called. This one proves that a function CANNOT BE ADDED that skips
 * the check — which is a different and, for access control, more useful claim.
 * A permission hole is never a failing assertion; it is a screen somebody wrote
 * on a Friday that nobody wrote a test for, and no amount of testing the screens
 * that do exist finds it.
 *
 * ── WHY THESE FOUR RULES AND NOT A LINTER ──────────────────────────────────
 *
 * They are specific to this system's architecture, they are stated in its brief
 * ("Never trust client-side permissions. Enforce every permission server-side.
 * Do not rely only on hiding navigation links."), and they are exactly the
 * invariants a general linter has no way to know about.
 *
 * ── AND WHY EACH EXEMPTION IS NAMED ────────────────────────────────────────
 *
 * The allow-lists below carry a reason each, not a path each. A list of bare
 * paths rots into "the files that were failing when somebody added the test",
 * which is how a rule quietly stops meaning anything. If a file belongs on one
 * of these lists, it is because of something true about that file, and the
 * sentence saying what has to survive review.
 */

const APP = 'src/app/(app)';
const LIB = 'src/lib';

function walk(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, match));
    else if (match(entry)) out.push(full);
  }
  return out;
}

const read = (path: string) => readFileSync(path, 'utf8');

// ---------------------------------------------------------------------------
// 1. EVERY PAGE GUARDS ITSELF
// ---------------------------------------------------------------------------

describe('every signed-in page checks a permission', () => {
  it('calls pageGuard, requirePermission or requirePrincipal', () => {
    const unguarded = walk(APP, (n) => n === 'page.tsx').filter((path) => {
      const src = read(path);
      return (
        !src.includes('pageGuard(') &&
        !src.includes('requirePermission(') &&
        !src.includes('requirePrincipal(')
      );
    });

    expect(unguarded, `Pages with no guard:\n${unguarded.join('\n')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. EVERY SERVER ACTION CHECKS A PERMISSION
// ---------------------------------------------------------------------------

/**
 * Hiding a button is a courtesy. A server action is a POST endpoint that anybody
 * signed in can reach, whether or not they were shown the form.
 */
describe('every server action checks a permission', () => {
  it('calls requirePermission before it does anything', () => {
    const offenders: string[] = [];

    for (const path of walk(APP, (n) => n === 'actions.ts')) {
      const src = read(path);
      if (!src.includes("'use server'")) continue;

      for (const part of src.split('\nexport async function ').slice(1)) {
        const name = part.split('(')[0].trim();
        const body = part.split('\nexport ')[0];
        if (!body.includes('requirePermission(') && !body.includes('requirePrincipal(')) {
          offenders.push(`${path} :: ${name}`);
        }
      }
    }

    expect(offenders, `Actions with no permission check:\n${offenders.join('\n')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. EVERY ROUTE HANDLER CHECKS A PERMISSION
// ---------------------------------------------------------------------------

/**
 * A route is a URL, and a URL can be typed. The report export is the first one
 * in this system; this rule exists so the second one cannot forget.
 */
describe('every route handler checks a permission', () => {
  it('calls requirePermission', () => {
    const offenders = walk(APP, (n) => n === 'route.ts').filter(
      (path) => !read(path).includes('requirePermission('),
    );
    expect(offenders, `Routes with no permission check:\n${offenders.join('\n')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. NO WRITE BY BARE ID WITHOUT AN OWNERSHIP CHECK
// ---------------------------------------------------------------------------

/**
 * THE RULE THIS TEST WAS WRITTEN TO FIND A BREACH OF, and it found three.
 *
 * `db.thing.update({ where: { id } })` is safe only when the row was already
 * proved to belong to this organisation. The proof can be a scope filter in the
 * same function, or a read through something that took the principal. What is
 * never a proof is "every caller happens to check", which is what
 * `recordEventWithin`, `touchProgramme` and `dailyContextFor` were each relying
 * on — including, in the last two cases, for the function whose whole job is to
 * strip a veterinarian's approval off a health programme.
 *
 * Nothing was exploitable, because the callers did check. The point is that the
 * callers were the only thing standing there.
 */
const SCOPE_TOKENS = [
  'orgFilter',
  'siteFilter',
  'nestedSiteFilter',
  'siteIdFilter',
  'canAccessSite',
  'organisationId',
];

/**
 * Writes that are keyed on an id this system generated moments earlier, inside
 * the same transaction, so there is no caller-supplied id to check.
 */
const SELF_GENERATED = [
  {
    file: 'src/lib/flock-service.ts',
    fn: 'rebuildDerivedValues',
    why: 'A maintenance script that walks every group it has already fetched; the id comes from its own query, not from a request.',
  },
];

describe('no row is written by bare id without proving who owns it', () => {
  it('scopes, or reads through the principal, before every update or delete by id', () => {
    const offenders: string[] = [];

    for (const file of walk(LIB, (n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      const src = read(file);
      if (!src.includes("'server-only'")) continue;

      for (const part of src.split('\nexport async function ').slice(1)) {
        const name = part.split('(')[0].trim();
        const body = part.split('\nexport ')[0];

        const writes = [
          ...body.matchAll(
            /\b(?:db|tx)\.(\w+)\.(update|delete)\(\s*\{\s*where:\s*\{\s*id:\s*([A-Za-z_][\w.]*)\s*\}/g,
          ),
        ];

        for (const write of writes) {
          const before = body.slice(0, write.index);
          const scopedHere = SCOPE_TOKENS.some((t) => before.includes(t));
          const readThroughPrincipal = /\w+\(\s*principal\s*,/.test(before);
          const exempt = SELF_GENERATED.some((e) => e.file === file && e.fn === name);

          if (!scopedHere && !readThroughPrincipal && !exempt) {
            offenders.push(`${file} :: ${name} -> ${write[1]}.${write[2]} by ${write[3]}`);
          }
        }
      }
    }

    expect(
      offenders,
      `Unscoped writes by id:\n${offenders.join('\n')}\n\n` +
        'Either filter by organisation in the same query, or read the row first ' +
        'through a function that takes the principal.',
    ).toEqual([]);
  });

  it('names a reason for every exemption, so the list cannot rot into a backlog', () => {
    for (const exemption of SELF_GENERATED) {
      expect(exemption.why.length).toBeGreaterThan(40);
      // The file still has to exist, or the exemption is covering nothing.
      expect(() => read(exemption.file)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. THE LEDGER WRITERS SCOPE THEMSELVES
// ---------------------------------------------------------------------------

/**
 * The append-only ledgers are the sharpest case: an event written against the
 * wrong flock or the wrong store cannot be deleted, only offset by an adjustment
 * that is itself permanent. These two functions are the only sanctioned writers,
 * and they are named here so that neither can quietly stop checking.
 */
describe('the ledger writers verify ownership themselves', () => {
  const writers = [
    { file: 'src/lib/flock-service.ts', fn: 'recordEventWithin', ledger: 'the population ledger' },
    { file: 'src/lib/stock-movements.ts', fn: 'recordMovementWithin', ledger: 'the stock ledger' },
  ];

  for (const writer of writers) {
    it(`${writer.fn} scopes and checks the site before writing to ${writer.ledger}`, () => {
      const src = read(writer.file);
      const body = src.split(`export async function ${writer.fn}(`)[1].split('\nexport ')[0];
      expect(body).toMatch(/organisationId/);
      expect(body).toMatch(/canAccessSite/);
    });
  }
});
