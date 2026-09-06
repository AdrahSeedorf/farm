import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { db } from '@/lib/db';
import { verifyPassword, verifyPin, burnTime } from '@/lib/password';
import { toE164 } from '@/lib/ghana';
import type { Role } from '@/lib/rbac';

/**
 * Authentication — ADRAH Farms
 *
 * Auth.js v5 with a Credentials provider. Two decisions worth knowing:
 *
 * WHY JWT SESSIONS, NOT DATABASE SESSIONS
 *   Auth.js's Credentials provider requires the JWT session strategy. That is a
 *   constraint of the library, not a preference — and it has a real consequence:
 *   a signed token in a cookie cannot be revoked server-side the way a database
 *   session row can. If a supervisor is dismissed, deleting a row is not enough,
 *   because their existing token stays valid until it expires.
 *
 *   SO WE RE-VALIDATE ON EVERY REQUEST. The `jwt` callback below re-reads the
 *   user from the database on each call and returns null the moment they are
 *   deactivated or deleted. That restores immediate revocation at the cost of one
 *   small indexed query per request — a trade that is obviously correct at this
 *   scale, and one that also keeps roles current without forcing a re-login.
 *
 * WHY SESSIONS ARE SHORT
 *   Eight hours: about one working day on the farm. A phone left in a poultry
 *   house should not stay signed in overnight.
 */

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

const pinSchema = z.object({
  phone: z.string().trim().min(1),
  pin: z.string().trim().regex(/^\d+$/),
});

/** Shape stored in the token and exposed on the session. */
export interface SessionUserFields {
  id: string;
  name: string;
  organisationId: string;
  roles: Role[];
  siteScope: string[];
}

async function loadSessionUser(userId: string): Promise<SessionUserFields | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      // Carried on the token so rendering the header does not need its own query.
      name: true,
      isActive: true,
      organisationId: true,
      roles: { select: { role: { select: { key: true } } } },
      siteScopes: { select: { siteId: true } },
    },
  });

  // Deactivated or deleted between requests — deny immediately.
  if (!user || !user.isActive) return null;

  return {
    id: user.id,
    name: user.name,
    organisationId: user.organisationId,
    roles: user.roles.map((r) => r.role.key as Role),
    siteScope: user.siteScopes.map((s) => s.siteId),
  };
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 8, // 8 hours — one working day
  },
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = await db.user.findUnique({
          where: { email },
          select: { id: true, email: true, name: true, passwordHash: true, isActive: true },
        });

        // Burn comparable time when the account does not exist, so response
        // timing cannot be used to enumerate which emails are registered.
        if (!user?.passwordHash) {
          await burnTime(password);
          return null;
        }

        const ok = await verifyPassword(user.passwordHash, password);
        if (!ok) return null;

        // A disabled account fails at the same point as a wrong password, and
        // with the same message — we do not confirm the account exists.
        if (!user.isActive) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),

    /**
     * Phone + PIN, for farm staff who have no email address.
     *
     * A SEPARATE PROVIDER, not a second branch inside the one above. Two
     * credentials with different strengths, different rate limits and different
     * failure messages sharing one `authorize` is how a rate limit meant for
     * PINs eventually gets applied to passwords, or worse, the other way round.
     *
     * THE PIN IS ONLY ONE OF THREE THINGS holding this shut. The other two are
     * the tighter limit in rate-limit.ts and the rule in pin.ts that no account
     * able to see money or change access may hold a PIN at all. None of them is
     * sufficient alone and the comment is here so nobody removes one thinking
     * the others cover it.
     */
    Credentials({
      id: 'pin',
      name: 'Phone and PIN',
      credentials: {
        phone: { label: 'Phone', type: 'tel' },
        pin: { label: 'PIN', type: 'password' },
      },
      async authorize(raw) {
        const parsed = pinSchema.safeParse(raw);
        if (!parsed.success) return null;

        // Normalised, so "024 123 4567" and "+233241234567" are one account and
        // one rate-limit key rather than two of each.
        const phone = toE164(parsed.data.phone);
        if (!phone) return null;

        const user = await db.user.findUnique({
          where: { phone },
          select: { id: true, name: true, phone: true, pinHash: true, isActive: true },
        });

        if (!user?.pinHash) {
          await burnTime(parsed.data.pin);
          return null;
        }

        const ok = await verifyPin(user.pinHash, parsed.data.pin);
        if (!ok) return null;
        if (!user.isActive) return null;

        return { id: user.id, name: user.name };
      },
    }),
  ],
  callbacks: {
    /**
     * Runs on sign-in AND on every subsequent request. This is where revocation
     * lives: returning null invalidates the session immediately.
     */
    async jwt({ token, user }) {
      const userId = user?.id ?? (token.sub as string | undefined);
      if (!userId) return null;

      const fresh = await loadSessionUser(userId);
      if (!fresh) return null; // deactivated, deleted, or roles gone

      token.sub = fresh.id;
      token.name = fresh.name;
      token.organisationId = fresh.organisationId;
      token.roles = fresh.roles;
      token.siteScope = fresh.siteScope;
      return token;
    },

    async session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
        session.user.name = token.name ?? '';
        session.user.organisationId = token.organisationId as string;
        session.user.roles = token.roles as Role[];
        session.user.siteScope = token.siteScope as string[];
      }
      return session;
    },
  },
  trustHost: true,
});
