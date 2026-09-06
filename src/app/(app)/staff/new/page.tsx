import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { staffContext } from '@/lib/staff-service';
import { StaffForm } from '../StaffForm';
import { addStaff } from '../actions';

export const metadata: Metadata = { title: 'Add someone' };

export default async function NewStaffPage() {
  const { principal, allowed } = await pageGuard('user:create');
  if (!allowed) return <Forbidden area="staff accounts" roles={principal.roles} />;

  const context = await staffContext(principal);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/staff" className="text-[14px] font-semibold text-brand-primary">
        ← People
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Add someone</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        Who they are and what they do. You set their password or PIN on the next screen —
        deliberately, because a credential typed on the same form as a name gets chosen
        carelessly.
      </p>

      <div className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <StaffForm
          action={addStaff}
          grantableRoles={context.roles}
          sites={context.sites}
          mayGrantEverySite={context.mayGrantEverySite}
          submitLabel="Create account"
          cancelHref="/staff"
        />
      </div>
    </main>
  );
}
