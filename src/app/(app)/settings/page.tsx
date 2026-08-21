import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { OrganisationForm } from './OrganisationForm';
import { updateOrganisation } from './actions';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const { principal, allowed } = await pageGuard('settings:view');
  if (!allowed) return <Forbidden area="settings" roles={principal.roles} />;

  const org = await db.organisation.findUnique({
    where: { id: principal.organisationId },
  });
  if (!org) return <Forbidden area="settings" roles={principal.roles} />;

  const canManage = await currentUserCan('settings:manage');

  const recentAudit = (await currentUserCan('audit:view'))
    ? await db.auditLog.findMany({
        where: { organisationId: principal.organisationId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { actor: { select: { name: true } } },
      })
    : [];

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="text-2xl font-bold text-text-primary">Settings</h1>

      <section className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
          Business
        </h2>
        <div className="mt-5">
          {canManage ? (
            <OrganisationForm
              action={updateOrganisation}
              defaults={{ name: org.name, legalName: org.legalName }}
            />
          ) : (
            <dl className="space-y-3 text-[15px]">
              <div>
                <dt className="text-[13px] text-text-muted">Name</dt>
                <dd className="text-text-primary">{org.name}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-text-muted">Legal name</dt>
                <dd className="text-text-primary">{org.legalName ?? '—'}</dd>
              </div>
            </dl>
          )}
        </div>

        <dl className="mt-6 grid gap-4 border-t border-border-default pt-5 sm:grid-cols-2">
          <div>
            <dt className="text-[13px] text-text-muted">Currency</dt>
            <dd className="text-[15px] font-semibold text-text-primary">{org.currency}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-text-muted">Timezone</dt>
            <dd className="text-[15px] font-semibold text-text-primary">{org.timezone}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[13px] text-text-muted">
          Currency and timezone are fixed after setup. Changing either would silently
          reinterpret every amount and every date already recorded, so it is a migration,
          not a setting.
        </p>
      </section>

      {recentAudit.length > 0 ? (
        <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
            Recent activity
          </h2>
          <ul className="mt-4 divide-y divide-border-default">
            {recentAudit.map((entry) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-4 py-2.5">
                <div>
                  <span className="font-mono text-[13px] text-text-primary">
                    {entry.action}
                  </span>
                  <span className="ml-2 text-[13px] text-text-secondary">
                    {entry.actor?.name ?? 'system'}
                  </span>
                </div>
                <time
                  dateTime={entry.createdAt.toISOString()}
                  className="tabular whitespace-nowrap text-[12px] text-text-muted"
                >
                  {entry.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                </time>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
