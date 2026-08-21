import '../src/lib/load-env';
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/lib/password';

/**
 * Set or reset a user's password — ADRAH Farms
 *
 *   npm run user:password -- owner@adrahfarms.com
 *   npm run user:password -- owner@adrahfarms.com "a passphrase you choose"
 *
 * With no password argument, a strong one is generated and printed once.
 *
 * WHY THIS EXISTS AS A SCRIPT
 *   The owner cannot reset their own password by email until the notification
 *   pipeline lands at Milestone 13. Until then, whoever has database access is
 *   the recovery path — which is correct for a single-owner farm, and is why
 *   this deliberately requires shell access rather than being a page in the app.
 *
 * It also clears any sign-in rate limiting on that account, since being locked
 * out is the usual reason for running it.
 */

const connectionString = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Check your .env.');
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const [emailArg, passwordArg] = process.argv.slice(2);

  if (!emailArg) {
    console.error('Usage: npm run user:password -- <email> [password]\n');
    const users = await db.user.findMany({
      select: { email: true, name: true, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (users.length === 0) {
      console.error('There are no users yet. Run `npm run db:seed` first.');
    } else {
      console.error('Known accounts:');
      for (const u of users) {
        console.error(`  ${u.email ?? '(no email)'}  ${u.name}${u.isActive ? '' : '  [inactive]'}`);
      }
    }
    process.exit(1);
  }

  const email = emailArg.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No account with the email ${email}.`);
    process.exit(1);
  }

  const generated = !passwordArg;
  const password = passwordArg ?? randomBytes(12).toString('base64url');

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(password),
      // Reactivate: being locked out and deactivated look identical from the
      // login form, and this is the tool for getting back in.
      isActive: true,
      mustChangePassword: generated,
    },
  });

  // Being rate limited is the other common reason for running this.
  const { count } = await db.loginAttempt.deleteMany({
    where: { identifier: email, successful: false },
  });

  console.log('\n─────────────────────────────────────────────');
  console.log('  PASSWORD UPDATED');
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
  if (generated) console.log('  Generated — shown once. Change it after signing in.');
  if (count > 0) console.log(`  Cleared ${count} failed sign-in attempt(s).`);
  console.log('─────────────────────────────────────────────\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
