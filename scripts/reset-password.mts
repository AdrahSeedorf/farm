import '../src/lib/load-env';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/lib/password';

/**
 * Break glass — ADRAH Farms
 *
 *   npm run password:reset -- somebody@adrahfarms.com
 *   npm run password:reset -- somebody@adrahfarms.com --ask
 *
 * WHY THIS EXISTS
 *
 * Everybody else on this farm has somebody above them. A worker who forgets
 * their PIN is reset by the owner on the People screen, and that is the right
 * way round: a credential handed out by a person who knows who they are handing
 * it to.
 *
 * The owner has nobody above them. Their password is Argon2id — the database
 * holds a verifier, not the password, and no amount of access to it will give
 * the password back. Without this script the recovery path for a locked-out
 * owner is somebody improvising with psql and a hash pasted off the internet,
 * at night, under pressure, on the live database. That is the worst possible
 * moment to be inventing a procedure.
 *
 * So the procedure is written down, narrow, and auditable.
 *
 * ── WHAT IT DELIBERATELY WILL NOT DO ───────────────────────────────────────
 *
 * It resets ONE password. It does not create users, grant roles, change site
 * scope or touch a PIN. A recovery tool that can also make somebody an owner is
 * not a recovery tool, it is a back door — and it would be the most attractive
 * file in the repository.
 *
 * ── AND WHY IT REFUSES THE PASSWORD ON THE COMMAND LINE ────────────────────
 *
 * `npm run password:reset -- owner@farm.com hunter2` would put that password in
 * the shell history of the machine, in the process list while it runs, and in
 * any terminal recording. It generates one instead, or reads it from a prompt
 * that does not echo it back.
 */

const connectionString = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Check your .env.');
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();
const ask = flags.has('--ask');
const assumeYes = flags.has('--yes');

/** The host, so nobody resets a password on the database they did not mean. */
function hostOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return 'unreadable connection string';
  }
}

function usage(): never {
  console.error('\n  Usage: npm run password:reset -- <email> [--ask] [--yes]\n');
  console.error('    --ask   type the new password instead of having one generated');
  console.error('    --yes   skip the confirmation (for a script; think before using it)\n');
  process.exit(1);
}

async function confirm(question: string): Promise<boolean> {
  if (assumeYes) return true;
  // A prompt nobody can answer must be a refusal, never an assumed yes.
  if (!stdin.isTTY) {
    console.error('\n  Not a terminal, and --yes was not given. Refusing.\n');
    return false;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

/** Read a password without echoing it to the screen or into a scrollback. */
async function readSecret(prompt: string): Promise<string> {
  if (!stdin.isTTY) {
    console.error('\n  --ask needs a terminal to type into.\n');
    process.exit(1);
  }
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  // @ts-expect-error _writeToOutput is Node's own hook for suppressing the echo.
  rl._writeToOutput = function (chunk: string) {
    if (chunk.includes(prompt)) stdout.write(prompt);
  };
  const value = await rl.question(prompt);
  rl.close();
  stdout.write('\n');
  return value;
}

async function main() {
  if (!email) usage();

  console.log(`\n  Database: ${hostOf(connectionString!)}\n`);

  const user = await db.user.findFirst({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      organisationId: true,
      isActive: true,
      roles: { select: { role: { select: { key: true, name: true } } } },
    },
  });

  if (!user) {
    // Says nothing about which part was wrong. This script is run from a
    // terminal by a person who should know, and it is not going to help
    // anybody else find out which addresses exist.
    console.error('  No account with that email address on this database.\n');
    process.exit(1);
  }

  const roles = user.roles.map((r) => r.role.name).join(', ') || 'no role';
  console.log(`  ${user.name} — ${user.email}`);
  console.log(`  ${roles}${user.isActive ? '' : '  (DEACTIVATED)'}\n`);

  if (!user.isActive) {
    // Deliberate: giving a working password to a deactivated account is how
    // somebody who was let go gets back in. Turn the account back on first,
    // which is a decision somebody makes on a screen with their name against it.
    console.error('  That account is deactivated. Reactivate it on the People screen first.\n');
    process.exit(1);
  }

  if (!(await confirm('  Give this account a new password?'))) {
    console.log('\n  Nothing changed.\n');
    process.exit(0);
  }

  let password: string;
  if (ask) {
    password = await readSecret('  New password: ');
    const again = await readSecret('  Type it again: ');
    if (password !== again) {
      console.error('\n  Those do not match. Nothing changed.\n');
      process.exit(1);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      console.error(`\n  Too short — ${MIN_PASSWORD_LENGTH} characters at least. Nothing changed.\n`);
      process.exit(1);
    }
  } else {
    password = randomBytes(12).toString('base64url');
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(password),
      /**
       * TRUE EVEN WHEN THEY CHOSE IT THEMSELVES, because the person at this
       * terminal is not necessarily the person who owns the account, and a
       * password that passed through somebody else's hands is a temporary one.
       */
      mustChangePassword: true,
    },
  });

  /**
   * AUDITED, AND THIS IS NOT OPTIONAL.
   *
   * This is the most security-sensitive thing the system can do. A password
   * reset that leaves no trace is indistinguishable afterwards from an intruder
   * who had the database for ten minutes. `actorId` is null because a command
   * line has no principal — and that null is itself the finding worth seeing in
   * the log: this did not come from the application.
   */
  await db.auditLog.create({
    data: {
      organisationId: user.organisationId,
      actorId: null,
      action: 'user.password.reset',
      entityType: 'User',
      entityId: user.id,
      after: { by: 'command line', chosen: ask ? 'typed' : 'generated' },
      userAgent: 'scripts/reset-password.mts',
    },
  });

  console.log('\n  ─────────────────────────────────────────────');
  console.log('   SIGN IN WITH');
  console.log(`   Email:    ${user.email}`);
  if (!ask) console.log(`   Password: ${password}`);
  console.log('   Shown once. Change it after signing in.');
  console.log('  ─────────────────────────────────────────────\n');
  console.log('  Written to the audit log as a command-line reset.\n');
}

main()
  .catch((error) => {
    console.error('\n  Failed:', error instanceof Error ? error.message : error, '\n');
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
