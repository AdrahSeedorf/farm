import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/brand/Logo';
import { getPrincipal } from '@/lib/session';
import { SignInPanel } from './SignInPanel';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ method?: string }>;
}) {
  // Already signed in — no reason to show the form.
  if (await getPrincipal()) redirect('/dashboard');

  // The tab to open on. Phone and PIN by default, because most people who sign
  // in to this every day are farmhands with no email address; ?method=email is
  // for the one person who signs in the other way and would rather bookmark it.
  const { method } = await searchParams;

  return (
    <main className="flex min-h-dvh flex-col bg-brand-primary">
      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex justify-center">
            <Logo tone="reversed" height={56} />
          </div>

          <div className="rounded-card bg-surface-card p-6 shadow-sm sm:p-7">
            <h1 className="text-xl font-bold text-text-primary">Sign in</h1>
            <p className="mt-1 mb-5 text-sm text-text-secondary">
              Farm management for ADRAH Farms.
            </p>
            <SignInPanel initialMethod={method === 'email' ? 'email' : 'pin'} />
          </div>

          <p className="mt-6 text-center text-[13px] text-brand-accent-on-dark">
            Farm staff sign in with their phone number and PIN.
          </p>
        </div>
      </div>
    </main>
  );
}
