'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { z } from 'zod';
import { signIn, signOut } from '@/auth';
import { db } from '@/lib/db';
import {
  checkLoginRateLimit,
  recordLoginAttempt,
  clearAccountFailures,
} from '@/lib/rate-limit';

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export interface LoginState {
  error?: string;
  fieldErrors?: { email?: string; password?: string };
}

/**
 * Sign in.
 *
 * ONE ERROR MESSAGE FOR EVERY FAILURE.
 *
 * Wrong password, unknown email, and deactivated account all return the same
 * text. Distinguishing them is friendlier to the one person who mistyped, and
 * enormously friendlier to the attacker working out which of ten thousand leaked
 * emails have accounts here. The rate-limit message is the deliberate exception —
 * telling someone to wait is useless if you cannot say why.
 */
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    return {
      fieldErrors: {
        email: flat.fieldErrors.email?.[0],
        password: flat.fieldErrors.password?.[0],
      },
    };
  }

  const { email, password } = parsed.data;
  const headerList = await headers();
  const ipAddress =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    null;
  const userAgent = headerList.get('user-agent');

  const limit = await checkLoginRateLimit(email, ipAddress);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    return {
      error: `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    };
  }

  try {
    await signIn('credentials', { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      await recordLoginAttempt({ identifier: email, successful: false, ipAddress, userAgent });
      return { error: 'Email or password is incorrect.' };
    }
    throw error;
  }

  await recordLoginAttempt({ identifier: email, successful: true, ipAddress, userAgent });
  await clearAccountFailures(email);
  await db.user
    .update({ where: { email }, data: { lastLoginAt: new Date() } })
    .catch(() => undefined); // never fail a valid sign-in over a timestamp

  redirect('/dashboard');
}

export async function logout(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}
