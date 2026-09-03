import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { ProgrammeForm } from '../ProgrammeForm';
import { createProgramme } from '../actions';

export const metadata: Metadata = { title: 'New health programme' };

export default async function NewProgrammePage() {
  const { principal, allowed } = await pageGuard('health:create');
  if (!allowed) return <Forbidden area="health records" roles={principal.roles} />;

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/health" className="text-[14px] font-semibold text-brand-primary">
        ← Health
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Start a programme</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        Name it and record where it came from. You add the entries next — by pasting the
        table your vet or hatchery gave you, or one at a time.
      </p>

      <div className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <ProgrammeForm
          action={createProgramme}
          submitLabel="Create programme"
          cancelHref="/health"
        />
      </div>
    </main>
  );
}
