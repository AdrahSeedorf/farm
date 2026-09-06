import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { staffById } from '@/lib/staff-service';
import { pinIsPermittedFor } from '@/lib/pin';
import { SetPinForm, SetPasswordForm, DeactivateForm } from '../CredentialForms';

export const metadata: Metadata = { title: 'Account' };

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function StaffMemberPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const { principal, allowed } = await pageGuard('user:view');
  if (!allowed) return <Forbidden area="staff accounts" roles={principal.roles} />;

  const person = await staffById(principal, userId);
  if (!person) notFound();

  const canEdit = await currentUserCan('user:edit');
  const pinVerdict = pinIsPermittedFor(person.roles);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/staff" className="text-[14px] font-semibold text-brand-primary">
        ← People
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{person.name}</h1>
          <p className="mt-1 text-[14px] capitalize text-text-secondary">
            {person.roles.join(' · ')}
            {person.isActive ? '' : ' — deactivated'}
          </p>
        </div>
        {canEdit ? (
          <Link
            href={`/staff/${person.id}/edit`}
            className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-5 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
          >
            Edit
          </Link>
        ) : null}
      </div>

      <section className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <p className="text-[15px] font-medium text-text-primary">{person.reach}</p>
        <dl className="mt-5 grid gap-4 border-t border-border-default pt-4 sm:grid-cols-2">
          <div>
            <dt className="text-[13px] text-text-muted">Phone</dt>
            <dd className="text-[15px] text-text-primary">
              {person.phoneDisplay ?? 'Not recorded'}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-text-muted">Email</dt>
            <dd className="text-[15px] text-text-primary">{person.email ?? 'Not recorded'}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-text-muted">Farms</dt>
            <dd className="text-[15px] text-text-primary">
              {person.everySite ? 'Every farm' : person.siteNames.join(', ') || 'None'}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-text-muted">Last signed in</dt>
            <dd className="tabular text-[15px] text-text-primary">
              {person.lastLoginAt ? day(person.lastLoginAt) : 'Never'}
            </dd>
          </div>
        </dl>

        {person.credential === 'NONE' ? (
          <p className="mt-5 rounded-control border border-status-attention bg-status-attention-bg px-3.5 py-2.5 text-[14px] font-medium text-status-attention">
            This account cannot be signed into. Set a PIN or a password below.
          </p>
        ) : null}
        {person.mustChangePassword ? (
          <p className="mt-3 text-[13px] text-text-secondary">
            They will be asked to change their password the next time they sign in.
          </p>
        ) : null}
      </section>

      {canEdit ? (
        <>
          <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
            <h2 className="text-lg font-semibold text-text-primary">
              {person.credential === 'PIN' || person.credential === 'BOTH'
                ? 'Change their PIN'
                : 'Give them a PIN'}
            </h2>

            {/* THE REFUSAL IS EXPLAINED, not hidden. Somebody who cannot find
                the PIN box on a manager's account will conclude the software is
                broken; somebody told why will understand the rule. */}
            {!pinVerdict.allowed ? (
              <p className="mt-2 max-w-lg text-[14px] text-text-secondary">
                {pinVerdict.reason}
              </p>
            ) : !person.phone ? (
              <p className="mt-2 max-w-lg text-[14px] text-text-secondary">
                A PIN is only half of it — add their phone number first, since that is what
                they type it against.
              </p>
            ) : (
              <div className="mt-4">
                <SetPinForm userId={person.id} phone={person.phone} />
              </div>
            )}
          </section>

          <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
            <h2 className="text-lg font-semibold text-text-primary">
              {person.credential === 'PASSWORD' || person.credential === 'BOTH'
                ? 'Change their password'
                : 'Give them a password'}
            </h2>
            {person.email ? (
              <div className="mt-4">
                <SetPasswordForm userId={person.id} />
              </div>
            ) : (
              <p className="mt-2 max-w-lg text-[14px] text-text-secondary">
                Add an email address first — that is what they would sign in with.
              </p>
            )}
          </section>

          {/* Not offered for your own account. The server refuses it too. */}
          {person.isSelf ? (
            <p className="mt-6 rounded-control border border-border-default bg-surface-sunken px-4 py-3 text-[14px] text-text-secondary">
              This is your own account, so it cannot be deactivated from here. Ask somebody
              else with account access to do it.
            </p>
          ) : (
            <DeactivateForm
              userId={person.id}
              isActive={person.isActive}
              name={person.name}
            />
          )}
        </>
      ) : null}
    </main>
  );
}
