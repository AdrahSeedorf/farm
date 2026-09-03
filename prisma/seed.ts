import '../src/lib/load-env';
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { SEED_UNITS } from '../src/lib/uom';
import { ROLE_PERMISSIONS, ROLES, allPermissions, parsePermission } from '../src/lib/rbac';
import { hashPassword } from '../src/lib/password';

/**
 * Seed — ADRAH Farms
 *
 * Idempotent: safe to run repeatedly. Creates the reference data the system
 * cannot function without (units, permissions, roles) plus a starting farm
 * structure for a layer operation rearing from day-old.
 *
 * Run with:  npm run db:seed
 */

// Seeding writes data, so it prefers the direct (unpooled) connection when one
// exists — same reasoning as migrations.
const connectionString = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
}

if (connectionString.includes('-pooler')) {
  console.warn(
    '\n  ⚠ Seeding through the POOLED connection.\n' +
      '    Set DIRECT_DATABASE_URL in .env to the same URL WITHOUT `-pooler`.\n' +
      '    Poolers close long-running connections, which can make this script\n' +
      '    stop part-way with no error at all.\n',
  );
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/**
 * A seed that stops half-way and says nothing is worse than one that crashes.
 *
 * If a query promise never settles — a pooler dropping the connection is the
 * usual cause — Node's event loop simply empties and the process exits with
 * code 0, looking like success. This sentinel turns that silence into a
 * visible, actionable failure.
 */
let completed = false;
process.on('exit', (code) => {
  if (!completed && code === 0) {
    console.error(
      '\n  ✕ Seed exited before finishing, without an error.\n' +
        '    This usually means the database connection was dropped mid-run.\n' +
        '    Check DIRECT_DATABASE_URL in .env, then run `npm run db:seed` again —\n' +
        '    seeding is idempotent, so re-running is safe.\n',
    );
    process.exitCode = 1;
  }
});

async function main() {
  console.log('Seeding ADRAH Farms…');

  // --- Units of measure -----------------------------------------------------
  // Also one round trip. A conversion factor must never be silently changed
  // under data already recorded with it, so existing rows are left alone —
  // changing "bag" from 50 kg to 25 kg is a migration, not a re-seed.
  await db.unitOfMeasure.createMany({
    data: SEED_UNITS.map((unit) => ({
      key: unit.key,
      name: unit.name,
      symbol: unit.symbol,
      dimension: unit.dimension,
      factorToBase: unit.factorToBase,
      isBase: unit.isBase ?? false,
    })),
    skipDuplicates: true,
  });
  console.log(`  ✓ ${SEED_UNITS.length} units of measure`);

  // --- Permissions and roles ------------------------------------------------
  //
  // ONE round trip, not 175.
  //
  // This was a loop of individual upserts. Locally that is invisible; against a
  // database in Frankfurt it is 175 sequential round trips, each waiting on the
  // last — slow, and a long window in which a pooled connection can be closed
  // underneath the script. Permissions are immutable (key, resource, action
  // never change), so `createMany` with `skipDuplicates` is both correct and
  // dramatically faster.
  const permissions = allPermissions();
  await db.permission.createMany({
    data: permissions.map((key) => ({ key, ...parsePermission(key) })),
    skipDuplicates: true,
  });
  console.log(`  ✓ ${permissions.length} permissions`);

  const roleNames: Record<string, string> = {
    owner: 'Owner',
    manager: 'Manager',
    supervisor: 'Supervisor',
    worker: 'Farm Worker',
    storekeeper: 'Storekeeper',
    sales: 'Sales',
    driver: 'Driver',
    vet: 'Veterinary',
    customer: 'Customer',
  };

  for (const roleKey of ROLES) {
    const role = await db.role.upsert({
      where: { key: roleKey },
      update: { name: roleNames[roleKey] },
      create: { key: roleKey, name: roleNames[roleKey], isSystem: true },
    });

    // Re-apply the matrix from code, so rbac.ts stays the single source of truth.
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    const perms = await db.permission.findMany({
      where: { key: { in: ROLE_PERMISSIONS[roleKey] } },
      select: { id: true },
    });
    await db.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }
  console.log(`  ✓ ${ROLES.length} roles with permissions applied from rbac.ts`);

  // --- Organisation ---------------------------------------------------------
  const org = await db.organisation.upsert({
    where: { id: 'adrah' },
    update: {},
    create: {
      id: 'adrah',
      name: 'ADRAH Farms',
      legalName: 'ADRAH Farms',
      currency: 'GHS',
      timezone: 'Africa/Accra',
    },
  });

  const site = await db.site.upsert({
    where: { organisationId_code: { organisationId: org.id, code: 'FARM1' } },
    update: {},
    create: {
      organisationId: org.id,
      name: 'Main Farm',
      code: 'FARM1',
      // Region/district to be confirmed — spec assumption A2.
    },
  });

  for (const [code, name] of [
    ['H-A', 'House A'],
    ['H-B', 'House B'],
  ] as const) {
    await db.productionUnit.upsert({
      where: { siteId_code: { siteId: site.id, code } },
      update: {},
      create: { siteId: site.id, name, code, capacity: 1250 },
    });
  }
  console.log('  ✓ Organisation, site and two houses');

  await db.stockLocation.upsert({
    where: { siteId_code: { siteId: site.id, code: 'STORE' } },
    update: {},
    create: { siteId: site.id, name: 'Farm Store', code: 'STORE' },
  });

  // --- Species framework ----------------------------------------------------
  const poultry = await db.speciesProfile.upsert({
    where: { organisationId_key: { organisationId: org.id, key: 'poultry' } },
    update: {},
    create: {
      organisationId: org.id,
      key: 'poultry',
      name: 'Poultry',
      terminology: {
        animal: 'Bird',
        animalGroup: 'Flock',
        productionUnit: 'House',
        production: 'Eggs',
      },
    },
  });

  const layer = await db.productionTypeProfile.upsert({
    where: { speciesProfileId_key: { speciesProfileId: poultry.id, key: 'layer' } },
    update: {},
    create: {
      speciesProfileId: poultry.id,
      key: 'layer',
      name: 'Layer',
      capabilities: {
        eggProduction: true,
        eggGrading: true,
        weightSampling: true,
        lightingProgramme: true,
        brooding: true,
        milkYield: false,
      },
      // CONFIGURATION, not application logic. Replace with the standards for the
      // breed actually purchased, on veterinary and hatchery advice.
      standards: {
        breed: null,
        note:
          'Breed standards not yet configured. Load the body-weight and lay-curve ' +
          'tables for the breed purchased before the first weight sample is taken.',
        mortalityAlertPctDaily: 0.5,
        uniformityTargetCvPct: 10,
        pointOfLayAgeDays: 126,
      },
    },
  });

  // Lifecycle for a layer reared from day-old.
  //
  // `productionStart` marks where the flock stops being an investment and starts
  // being an asset that earns. It is a flag on the stage, not a key matched in
  // code, so a future species can point it at "lactating" or "harvest" without
  // anything in the costing layer knowing what a laying hen is.
  const stages = [
    { key: 'brooding', name: 'Brooding', sequence: 1, start: 0, end: 28, productionStart: false },
    { key: 'growing', name: 'Growing', sequence: 2, start: 29, end: 112, productionStart: false },
    { key: 'pre_lay', name: 'Pre-lay', sequence: 3, start: 113, end: 133, productionStart: false },
    { key: 'laying', name: 'Laying', sequence: 4, start: 134, end: 525, productionStart: true },
    { key: 'depleting', name: 'Depleting', sequence: 5, start: 526, end: null, productionStart: false },
  ];

  for (const s of stages) {
    await db.lifecycleStage.upsert({
      where: { productionTypeProfileId_key: { productionTypeProfileId: layer.id, key: s.key } },
      update: { name: s.name, sequence: s.sequence, isProductionStart: s.productionStart },
      create: {
        productionTypeProfileId: layer.id,
        key: s.key,
        name: s.name,
        sequence: s.sequence,
        typicalStartAgeDays: s.start,
        typicalEndAgeDays: s.end,
        isProductionStart: s.productionStart,
      },
    });
  }
  console.log(`  ✓ Poultry species, layer production type, ${stages.length} lifecycle stages`);

  // --- Breed catalogue ------------------------------------------------------
  //
  // NAMES ONLY. These are layer breeds commonly sold as day-olds in Ghana,
  // seeded so the placement form offers a choice instead of a free-text box:
  // "Isa brown", "ISA Brown" and "isa" would otherwise be three different breeds
  // as far as any later report is concerned.
  //
  // NO WEIGHT FIGURES ARE SEEDED. Those come from each breeder's own management
  // guide via `npm run standards:load`, and a breed without them reports no
  // comparison rather than scoring a flock against a guess.
  const layerBreeds = [
    ['isa_brown', 'ISA Brown', 'ISA / Hendrix Genetics'],
    ['lohmann_brown', 'Lohmann Brown Classic', 'Lohmann Breeders'],
    ['hy_line_brown', 'Hy-Line Brown', 'Hy-Line International'],
    ['bovans_brown', 'Bovans Brown', 'Bovans / Hendrix Genetics'],
    ['hisex_brown', 'Hisex Brown', 'Hisex / Hendrix Genetics'],
    ['nova_brown', 'Nova Brown', 'Hendrix Genetics'],
  ] as const;

  for (const [key, name, supplier] of layerBreeds) {
    await db.breed.upsert({
      where: { organisationId_key: { organisationId: org.id, key } },
      update: {},
      create: {
        organisationId: org.id,
        speciesProfileId: poultry.id,
        productionTypeProfileId: layer.id,
        key,
        name,
        supplier,
      },
    });
  }
  console.log(`  \u2713 ${layerBreeds.length} layer breeds (names only, no weight figures)`);

  // --- First owner account -------------------------------------------------
  //
  // Created only if no user exists, so re-seeding never resets your password.
  // The password comes from SEED_OWNER_PASSWORD; if unset we generate a random
  // one and print it ONCE. There is deliberately no default password in this
  // file — a committed default is a default that reaches production.
  const existingUsers = await db.user.count();
  if (existingUsers === 0) {
    const email = process.env.SEED_OWNER_EMAIL ?? 'owner@adrahfarms.com';
    const generated = !process.env.SEED_OWNER_PASSWORD;
    const password = process.env.SEED_OWNER_PASSWORD ?? randomBytes(12).toString('base64url');

    const ownerRole = await db.role.findUniqueOrThrow({ where: { key: 'owner' } });
    const user = await db.user.create({
      data: {
        organisationId: org.id,
        email,
        name: process.env.SEED_OWNER_NAME ?? 'Owner',
        passwordHash: await hashPassword(password),
        mustChangePassword: generated,
        roles: { create: { roleId: ownerRole.id } },
        // No UserSiteScope rows = access to every site.
      },
    });

    console.log(`  ✓ Owner account created: ${user.email}`);
    if (generated) {
      console.log('\n  ─────────────────────────────────────────────');
      console.log('   SIGN IN WITH');
      console.log(`   Email:    ${email}`);
      console.log(`   Password: ${password}`);
      console.log('   This is shown once. Change it after signing in.');
      console.log('  ─────────────────────────────────────────────\n');
    }
  } else {
    console.log(`  ✓ ${existingUsers} user(s) already exist — owner account left untouched`);
  }

  console.log('\nSeed complete.');
  completed = true;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
