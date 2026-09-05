import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { cleaningOptions } from '@/lib/cleaning-service';
import { CleaningForm } from '../../CleaningForm';

export const metadata: Metadata = { title: 'Record a clean' };

export default async function NewCleaningPage() {
  const { principal, allowed } = await pageGuard('biosecurity:create');
  if (!allowed) return <Forbidden area="cleaning records" roles={principal.roles} />;

  const options = await cleaningOptions(principal);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/biosecurity/cleaning" className="text-[14px] font-semibold text-brand-primary">
        ← Cleaning
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-text-primary">Record a clean</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        One row per stage. The form stays put so a run of houses can be entered one after
        another.
      </p>

      <div className="mt-8">
        <CleaningForm options={options} today={new Date().toISOString().slice(0, 10)} />
      </div>
    </main>
  );
}
