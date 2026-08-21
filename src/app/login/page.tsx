import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/brand/Logo';
import { getPrincipal } from '@/lib/session';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  // Already signed in — no reason to show the form.
  if (await getPrincipal()) redirect('/dashboard');

  return (
    <main className="flex min-h-dvh flex-col bg-brand-primary">
      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex justify-center">
            <Logo tone="reversed" height={56} />
          </div>

          <div className="rounded-card bg-surface-card p-6 shadow-sm sm:p-7">
            <h1 className="text-xl font-bold text-text-primary">Sign in</h1>
            <p className="mt-1 text-sm text-text-secondary">
              Farm management for ADRAH Farms.
            </p>
            <LoginForm />
          </div>

          <p className="mt-6 text-center text-[13px] text-brand-accent-on-dark">
            Staff sign-in by phone arrives with the staff portal.
          </p>
        </div>
      </div>
    </main>
  );
}
