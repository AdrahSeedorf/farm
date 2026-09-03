import '../src/lib/load-env';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { hashPassword } from '../src/lib/password';

/**
 * Create a throwaway account — ADRAH Farms
 *
 * NOT PART OF THE APPLICATION, and not intended to be committed. Proper user
 * management arrives at Milestone 12; this exists only so that screens can be
 * driven in a browser and signed-in behaviour verified before then.
 *
 *   npx tsx scripts/create-test-user.ts <email> "<name>" <roleKey> "<password>"
 *
 * e.g.
 *   npx tsx scripts/create-test-user.ts test-owner@adrahfarms.com "Test Owner" owner "..."
 *   npx tsx scripts/create-test-user.ts test-worker@adrahfarms.com "Test Worker" worker "..."
 *
 * Accounts made this way are ORDINARY USERS. Their actions appear in the audit
 * log under their own names, which is correct, and they should be deactivated
 * (`User.isActive = false`) before the farm goes live. No site scope rows are
 * created, so the account can reach every site — add rows by hand to test that
 * a supervisor at one farm cannot read another.
 */

const [emailArg, nameArg, roleKey, password] = process.argv.slice(2);
if (!emailArg || !nameArg || !roleKey || !password) {
  console.error(
    'Usage: npx tsx scripts/create-test-user.ts <email> "<name>" <roleKey> "<password>"',
  );
  process.exit(1);
}

const connectionString = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Check your .env.');
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const email = emailArg.trim().toLowerCase();
  const org = await db.organisation.findFirstOrThrow();
  const role = await db.role.findUnique({ where: { key: roleKey } });
  if (!role) {
    const roles = await db.role.findMany({ select: { key: true } });
    console.error(`No role "${roleKey}". Known: ${roles.map((r) => r.key).join(', ')}`);
    process.exit(1);
  }

  const user = await db.user.upsert({
    where: { email },
    update: { passwordHash: await hashPassword(password), isActive: true },
    create: {
      organisationId: org.id,
      email,
      name: nameArg,
      passwordHash: await hashPassword(password),
      roles: { create: { roleId: role.id } },
    },
    select: { id: true, email: true },
  });

  console.log(`Ready: ${user.email} as ${roleKey}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
