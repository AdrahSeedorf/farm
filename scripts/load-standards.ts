import '../src/lib/load-env';
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { parseStandardTable, toStandardMap } from '../src/lib/standards';

/**
 * Load a breed's body-weight standard — ADRAH Farms
 *
 *   npm run standards:load -- standards/isa-brown.csv --breed isa_brown
 *   npm run standards:load -- standards/isa-brown.csv --breed isa_brown --dry-run
 *
 * The breed key is REQUIRED. A weight curve belongs to a breed, not to "layer":
 * an ISA Brown and a Lohmann Brown are both layers and do not weigh the same at
 * eight weeks, so loading one table against every layer would report a healthy
 * flock as behind target.
 *
 * The file is a two-column table copied out of the breed's management guide:
 *
 *   week,grams
 *   1,70
 *   2,115
 *   …
 *
 * An `ageDays` column works equally well. Once loaded, every weight sample is
 * scored against it — on target, or behind, at that flock's exact age.
 *
 * Nothing is invented here. If the figures are not loaded, the weights page says
 * so plainly rather than comparing against a guess.
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
  const file = args.filter((a, i) => !a.startsWith('--') && i !== breedIndex + 1)[0];

  if (!file || !breedKey) {
    console.error('Usage: npm run standards:load -- <file.csv> --breed <key> [--dry-run]\n');
    console.error('The file is a two-column table from your breed guide:\n');
    console.error('  week,grams');
    console.error('  1,70');
    console.error('  2,115\n');
    process.exit(1);
  }

  let contents: string;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    console.error(`Could not read ${file}.`);
    process.exit(1);
  }

  const { rows, warnings, errors } = parseStandardTable(contents);

  for (const w of warnings) console.warn(`  ⚠ ${w}`);
  if (errors.length > 0) {
    console.error('\n  Could not load the table:');
    for (const e of errors) console.error(`  ✕ ${e}`);
    process.exit(1);
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  console.log(`\n  Read ${rows.length} points:`);
  console.log(`    day ${first.ageDays} → ${first.grams} g`);
  console.log(`    day ${last.ageDays} → ${last.grams} g`);

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

  await db.breed.update({
    where: { id: breed.id },
    data: {
      standards: {
        ...existing,
        bodyWeightByAgeDays: toStandardMap(rows),
        // Kept so a later reader can tell where these figures came from.
        bodyWeightSource: file,
        bodyWeightLoadedAt: new Date().toISOString(),
      },
    },
  });

  console.log(`\n  ✓ Loaded into ${breed.name}.`);
  console.log('    Weight samples on flocks of this breed now compare against it.\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
