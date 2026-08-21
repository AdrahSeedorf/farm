import type { DefaultSession } from 'next-auth';
import type { Role } from '@/lib/rbac';

/**
 * Type augmentation so `session.user.roles` is typed rather than `any`.
 * Without this the authorisation gate would take untyped input, which is exactly
 * the place you least want the compiler to stop helping.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      organisationId: string;
      roles: Role[];
      siteScope: string[];
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    organisationId?: string;
    roles?: Role[];
    siteScope?: string[];
  }
}

export {};
