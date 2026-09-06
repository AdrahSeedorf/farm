import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { staffById, staffContext } from '@/lib/staff-service';
import { StaffForm } from '../../StaffForm';
import { editStaff } from '../../actions';

export const metadata: Metadata = { title: 'Edit account' };

export default async function EditStaffPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const { principal, allowed } = await pageGuard('user:edit');
  if (!allowed) return <Forbidden area="staff accounts" roles={principal.roles} />;

  const [person, context] = await Promise.all([
    staffById(principal, userId),
    staffContext(principal),
  ]);
  if (!person) notFound();

  const action = editStaff.bind(null, person.id);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link
        href={`/staff/${person.id}`}
        className="text-[14px] font-semibold text-brand-primary"
      >
        ← {person.name}
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Edit account</h1>

      <div className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <StaffForm
          action={action}
          grantableRoles={context.roles}
          sites={context.sites}
          mayGrantEverySite={context.mayGrantEverySite}
          defaults={{
            name: person.name,
            email: person.email,
            phone: person.phone,
            roles: person.roles,
            siteIds: person.siteIds,
            everySite: person.everySite,
          }}
          submitLabel="Save changes"
          cancelHref={`/staff/${person.id}`}
        />
      </div>
    </main>
  );
}
