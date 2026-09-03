import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { OrganisationForm } from './OrganisationForm';
import { BreedForm } from './BreedForm';
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

  const breeds = await db.breed.findMany({
    where: { organisationId: principal.organisationId, isActive: true },
    orderBy: { name: 'asc' },
  });

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
              defaults={{
                name: org.name,
                legalName: org.legalName,
                stockLeadTimeDays: org.stockLeadTimeDays,
                pulletMarketPrice:
                  org.pulletMarketPricePesewas === null
                    ? ''
                    : (org.pulletMarketPricePesewas / 100).toFixed(2),
                pulletMarketPriceOn:
                  org.pulletMarketPriceOn?.toISOString().slice(0, 10) ?? '',
                pulletMarketPriceSource: org.pulletMarketPriceSource ?? '',
              }}
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
              <div>
                <dt className="text-[13px] text-text-muted">Stock lead time</dt>
                <dd className="text-text-primary">{org.stockLeadTimeDays} days</dd>
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

      <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
          Breeds
        </h2>
        <p className="mt-3 text-[14px] text-text-secondary">
          Chosen when a flock is placed. The weight curve belongs to the breed, not to
          &ldquo;layer&rdquo; — an ISA Brown and a Lohmann Brown do not weigh the same at
          eight weeks.
        </p>

        <ul className="mt-4 divide-y divide-border-default">
          {breeds.map((b) => {
            const loaded =
              b.standards &&
              typeof b.standards === 'object' &&
              'bodyWeightByAgeDays' in (b.standards as Record<string, unknown>);
            return (
              <li key={b.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                <span className="text-[15px] font-semibold text-text-primary">{b.name}</span>
                <span className="font-mono text-[12px] text-text-muted">{b.key}</span>
                {b.supplier ? (
                  <span className="text-[13px] text-text-secondary">{b.supplier}</span>
                ) : null}
                <span
                  className={`ml-auto text-[13px] ${
                    loaded ? 'text-text-secondary' : 'text-status-attention'
                  }`}
                >
                  {loaded ? 'Weight table loaded' : 'No weight table'}
                </span>
              </li>
            );
          })}
        </ul>

        <p className="mt-4 rounded-control border border-border-default bg-surface-sunken px-3.5 py-3 text-[13px] text-text-secondary">
          Weight figures come from the breeder&apos;s own management guide, never from this
          system. Load one with{' '}
          <code className="font-mono text-text-primary">
            npm run standards:load -- &lt;file.csv&gt; --breed &lt;key&gt;
          </code>
          . A breed with none reports no comparison rather than scoring a flock against a
          guess.
        </p>

        {canManage ? (
          <div className="mt-5 border-t border-border-default pt-5">
            <BreedForm />
          </div>
        ) : null}
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
