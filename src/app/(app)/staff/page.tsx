import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { listStaff } from '@/lib/staff-service';

export const metadata: Metadata = { title: 'People' };

const day = (d: Date) => d.toISOString().slice(0, 10);

const CREDENTIAL_LABEL: Record<string, string> = {
  PASSWORD: 'Email and password',
  PIN: 'Phone and PIN',
  BOTH: 'Email and phone',
  NONE: 'Cannot sign in yet',
};

/**
 * Everybody with an account.
 *
 * TWO THINGS ARE SURFACED ON THE CARD ON PURPOSE: what the account can reach,
 * and whether it can be signed into at all. A list of names and role labels
 * reads as tidy and tells whoever is scanning it nothing about which of these
 * people can see what the farm earns.
 */
export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ inactive?: string }>;
}) {
  const { principal, allowed } = await pageGuard('user:view');
  if (!allowed) return <Forbidden area="staff accounts" roles={principal.roles} />;

  const { inactive } = await searchParams;
  const showInactive = inactive === '1';

  const [people, canCreate] = await Promise.all([
    listStaff(principal, showInactive),
    currentUserCan('user:create'),
  ]);

  const noCredential = people.filter((p) => p.isActive && p.credential === 'NONE');

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">People</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            Who has an account, what it can reach, and how they sign in.
          </p>
        </div>
        {canCreate ? (
          <Link
            href="/staff/new"
            className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
          >
            Add someone
          </Link>
        ) : null}
      </div>

      {noCredential.length > 0 ? (
        <p className="mt-6 rounded-control border border-status-attention bg-status-attention-bg px-4 py-3 text-[14px] font-medium text-status-attention">
          {noCredential.length === 1
            ? `${noCredential[0].name} has no way to sign in yet.`
            : `${noCredential.length} accounts have no way to sign in yet.`}{' '}
          An account without a password or a PIN is a name on a list.
        </p>
      ) : null}

      <ul className="mt-6 space-y-3">
        {people.map((person) => (
          <li key={person.id}>
            <div
              className={`rounded-card border bg-surface-card p-5 ${
                person.isActive ? 'border-border-default' : 'border-dashed border-border-strong'
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-[17px] font-bold text-text-primary">
                  <Link href={`/staff/${person.id}`} className="hover:text-brand-primary">
                    {person.name}
                  </Link>
                  {/* A separate element with real words, not a bare "you" tacked
                      onto the name. Inline, a margin gives the eye a gap that the
                      text does not have, so a screen reader announced the owner's
                      card as "Owneryou". */}
                  {person.isSelf ? (
                    <span className="ml-2 text-[13px] font-normal text-text-muted">
                      (this is you)
                    </span>
                  ) : null}
                </h2>
                <span className="text-[13px] font-semibold capitalize text-text-secondary">
                  {person.roles.join(' · ')}
                </span>
              </div>

              {person.isActive ? null : (
                <p className="mt-1 text-[13px] font-semibold text-text-muted">Deactivated</p>
              )}

              <p className="mt-1.5 text-[14px] text-text-secondary">{person.reach}</p>

              <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-border-default pt-3 text-[13px]">
                <div>
                  <dt className="text-text-muted">Signs in with</dt>
                  <dd
                    className={`font-semibold ${
                      person.credential === 'NONE'
                        ? 'text-status-attention'
                        : 'text-text-primary'
                    }`}
                  >
                    {CREDENTIAL_LABEL[person.credential]}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-muted">Farms</dt>
                  <dd className="font-semibold text-text-primary">
                    {person.everySite ? 'Every farm' : person.siteNames.join(', ') || 'None'}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-muted">Last signed in</dt>
                  <dd className="tabular font-semibold text-text-primary">
                    {person.lastLoginAt ? day(person.lastLoginAt) : 'Never'}
                  </dd>
                </div>
              </dl>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-[14px]">
        <Link
          href={showInactive ? '/staff' : '/staff?inactive=1'}
          className="font-semibold text-brand-primary"
        >
          {showInactive ? 'Hide deactivated accounts' : 'Show deactivated accounts'}
        </Link>
      </p>
    </main>
  );
}
