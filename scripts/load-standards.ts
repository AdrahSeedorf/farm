import '../src/lib/load-env';
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  parseStandardTable,
  parseLayCurveTable,
  toStandardMap,
  toLayCurveMap,
  detectKind,
  type StandardKind,
} from '../src/lib/standards';

/**
 * Load a breed's published standards — ADRAH Farms
 *
 *   npm run standards:load -- standards/isa-brown-weight.csv --breed isa_brown
 *   npm run standards:load -- standards/isa-brown-lay.csv --breed isa_brown
 *   npm run standards:load -- standards/isa-brown-lay.csv --breed isa_brown --dry-run
 *
 * TWO KINDS OF TABLE, both two columns copied straight out of the management
 * guide. Which one you have is read off the header and PRINTED BEFORE ANYTHING
 * IS WRITTEN, so a lay curve can never land silently in the weight column:
 *
 *   week,grams        →  body weight, judged against every weight sample
 *   week,henDayPct    →  the lay curve, judged against production every week
 *
 * `--kind weight` or `--kind lay` overrides the detection when a header is
 * unusual. An `ageDays` column works in place of `week` for either.
 *
 * The breed key is REQUIRED. These curves belong to a breed, not to "layer": an
 * ISA Brown and a Lohmann Brown are both layers, and they neither weigh the same
 * at eight weeks nor lay the same at thirty. One table loaded against every
 * layer would report a healthy flock as behind target.
 *
 * Nothing is invented here. Without the figures the screens say so plainly
 * rather than comparing a flock against a guess.
 */

const connectionString = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Check your .env.');
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const breedIndex = args.indexOf('--breed');
  const breedKey = breedIndex === -1 ? undefined : args[breedIndex + 1];
  const kindIndex = args.indexOf('--kind');
  const kindArg = kindIndex === -1 ? undefined : args[kindIndex + 1];
  // The first bare argument that is not the VALUE of a flag. Guarded on the flag
  // actually being present: `indexOf` returns -1 when it is absent, and -1 + 1 is
  // 0, which would silently discard the filename.
  const consumed = new Set(
    [breedIndex, kindIndex].filter((i) => i !== -1).map((i) => i + 1),
  );
  const file = args.filter((a, i) => !a.startsWith('--') && !consumed.has(i))[0];

  if (!file || !breedKey) {
    console.error(
      'Usage: npm run standards:load -- <file.csv> --breed <key> [--kind weight|lay] [--dry-run]\n',
    );
    console.error('The file is a two-column table from your breed guide:\n');
    console.error('  week,grams        (body weight)');
    console.error('  1,70');
    console.error('  2,115\n');
    console.error('  week,henDayPct    (the lay curve)');
    console.error('  20,28.5');
    console.error('  21,58.0\n');
    process.exit(1);
  }

  if (kindArg !== undefined && kindArg !== 'weight' && kindArg !== 'lay') {
    console.error(`--kind must be "weight" or "lay", not "${kindArg}".`);
    process.exit(1);
  }

  let contents: string;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    console.error(`Could not read ${file}.`);
    process.exit(1);
  }

  // Said out loud before anything is written. A lay curve loaded into the weight
  // column would produce targets that look plausible and are nonsense.
  const kind: StandardKind | null = (kindArg as StandardKind | undefined) ?? detectKind(contents);
  if (!kind) {
    console.error(`\n  Could not tell what kind of table ${file} is.`);
    console.error('  Give it a "grams" or "henDayPct" column, or pass --kind weight|lay.\n');
    process.exit(1);
  }
  console.log(
    `\n  Reading ${file} as ${kind === 'weight' ? 'a BODY WEIGHT table' : 'a LAY CURVE'}.`,
  );

  const parsed =
    kind === 'weight' ? parseStandardTable(contents) : parseLayCurveTable(contents);

  for (const w of parsed.warnings) console.warn(`  ⚠ ${w}`);
  if (parsed.errors.length > 0) {
    console.error('\n  Could not load the table:');
    for (const e of parsed.errors) console.error(`  ✕ ${e}`);
    process.exit(1);
  }

  const describe = (row: { ageDays: number }) =>
    'grams' in row
      ? `day ${row.ageDays} → ${(row as { grams: number }).grams} g`
      : `day ${row.ageDays} → ${(row as unknown as { pct: number }).pct}%`;

  console.log(`  Read ${parsed.rows.length} points:`);
  console.log(`    ${describe(parsed.rows[0])}`);
  console.log(`    ${describe(parsed.rows[parsed.rows.length - 1])}`);

  if (dryRun) {
    console.log('\n  --dry-run: nothing written.\n');
    return;
  }

  const breed = await db.breed.findFirst({ where: { key: breedKey } });
  if (!breed) {
    const known = await db.breed.findMany({ select: { key: true, name: true } });
    console.error(`\n  No breed with the key "${breedKey}".`);
    if (known.length > 0) {
      console.error('  Known breeds:');
      for (const b of known) console.error(`    ${b.key.padEnd(18)} ${b.name}`);
    } else {
      console.error('  No breeds are set up. Run `npm run db:seed` first.');
    }
    process.exit(1);
  }

  const existing =
    breed.standards && typeof breed.standards === 'object' && !Array.isArray(breed.standards)
      ? (breed.standards as Record<string, unknown>)
      : {};

  // Kept alongside the figures so a later reader can tell which edition of which
  // guide they came from, and when.
  const provenance = { source: file, loadedAt: new Date().toISOString() };

  await db.breed.update({
    where: { id: breed.id },
    data: {
      standards:
        kind === 'weight'
          ? {
              ...existing,
              bodyWeightByAgeDays: toStandardMap(parsed.rows as { ageDays: number; grams: number }[]),
              bodyWeightSource: provenance.source,
              bodyWeightLoadedAt: provenance.loadedAt,
            }
          : {
              ...existing,
              henDayPctByAgeDays: toLayCurveMap(parsed.rows as { ageDays: number; pct: number }[]),
              henDayPctSource: provenance.source,
              henDayPctLoadedAt: provenance.loadedAt,
            },
    },
  });

  console.log(`\n  ✓ Loaded into ${breed.name}.`);
  console.log(
    kind === 'weight'
      ? '    Weight samples on flocks of this breed now compare against it.\n'
      : '    Production on flocks of this breed now compares against it, week by week.\n',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
