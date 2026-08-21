import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge proxy (Next.js 16's replacement for `middleware.ts`).
 *
 * THIS IS NOT THE SECURITY BOUNDARY. Read that again before adding anything here.
 *
 * It exists for one thing: sending a signed-out visitor to the login page
 * without first rendering a page they cannot use. It checks only for the
 * PRESENCE of a session cookie — it does not verify the signature, does not
 * read the roles, and grants nothing.
 *
 * Why so deliberately weak:
 *   - Next.js has shipped middleware-bypass vulnerabilities (CVE-2025-29927
 *     among them). Anything that is the only thing standing between a request
 *     and your data will eventually be bypassed.
 *   - Server Actions are invoked directly and do not necessarily pass through
 *     here at all.
 *   - The edge runtime cannot run our Argon2 or Prisma code anyway, so a real
 *     check is not even possible in this file.
 *
 * The real enforcement is `requirePrincipal()` / `requirePermission()` in
 * src/lib/session.ts, called by every page and action that touches data.
 */

const SESSION_COOKIES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
];

const PROTECTED_PREFIXES = ['/dashboard', '/farm', '/admin', '/staff'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isProtected) return NextResponse.next();

  const hasSessionCookie = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSessionCookie) return NextResponse.next();

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('from', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|avif)$).*)'],
};
