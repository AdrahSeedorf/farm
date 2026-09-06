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
  PIN_LIMITS,
} from '@/lib/rate-limit';
import { toE164 } from '@/lib/ghana';

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export interface LoginState {
  error?: string;
  fieldErrors?: { email?: string; password?: string };
}

export interface PinLoginState {
  error?: string;
  fieldErrors?: { phone?: string; pin?: string };
}

const pinSchema = z.object({
  phone: z.string().trim().min(1, 'Enter your phone number.'),
  pin: z.string().trim().min(1, 'Enter your PIN.'),
});

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

/**
 * Sign in with a phone number and a PIN.
 *
 * A SEPARATE ACTION from `login` above, for the same reason there are two
 * providers: the rate limit is different, and one of the two must not be able to
 * accidentally borrow the other's.
 *
 * THE RATE LIMIT IS THE SECURITY HERE, not the secret. Six digits is a million
 * possibilities; five attempts per fifteen minutes is what turns that into about
 * 2.9 years of continuous guessing. If somebody ever loosens PIN_LIMITS to be
 * "friendlier", they are not adjusting a convenience setting — they are
 * shortening that number, and it moves fast: at eight attempts, the same PIN
 * falls in under two years.
 *
 * ONE MESSAGE FOR EVERY FAILURE, exactly as for the password path. Unknown
 * number, wrong PIN and deactivated account are indistinguishable from outside.
 */
export async function loginWithPin(
  _prev: PinLoginState,
  formData: FormData,
): Promise<PinLoginState> {
  const parsed = pinSchema.safeParse({
    phone: formData.get('phone'),
    pin: formData.get('pin'),
  });

  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    return {
      fieldErrors: {
        phone: flat.fieldErrors.phone?.[0],
        pin: flat.fieldErrors.pin?.[0],
      },
    };
  }

  // Normalised BEFORE it is used as a rate-limit key. Without this, the same
  // number typed five different ways is five separate allowances, and the limit
  // that carries the whole scheme quietly becomes five times weaker.
  const phone = toE164(parsed.data.phone);
  const headerList = await headers();
  const ipAddress =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    null;
  const userAgent = headerList.get('user-agent');

  // A number that cannot be a Ghanaian one still consumes an attempt. Otherwise
  // the check itself becomes a free oracle for probing the rate limiter.
  const identifier = phone ?? `bad:${parsed.data.phone.replace(/\D/g, '').slice(0, 20)}`;

  const limit = await checkLoginRateLimit(identifier, ipAddress, PIN_LIMITS);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    return {
      error:
        `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, ` +
        'or ask your manager to reset your PIN.',
    };
  }

  if (!phone) {
    await recordLoginAttempt({ identifier, successful: false, ipAddress, userAgent });
    return { error: 'Phone number or PIN is incorrect.' };
  }

  try {
    await signIn('pin', { phone, pin: parsed.data.pin, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      await recordLoginAttempt({ identifier, successful: false, ipAddress, userAgent });
      return { error: 'Phone number or PIN is incorrect.' };
    }
    throw error;
  }

  await recordLoginAttempt({ identifier, successful: true, ipAddress, userAgent });
  await clearAccountFailures(identifier);
  await db.user
    .update({ where: { phone }, data: { lastLoginAt: new Date() } })
    .catch(() => undefined);

  // Staff land on the day's work, not the dashboard — most of them cannot see
  // the dashboard at all, and bouncing them off a 403 on every sign-in is a
  // poor first impression of a system they are being asked to trust.
  redirect('/daily');
}
