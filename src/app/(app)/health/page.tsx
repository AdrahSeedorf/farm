import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { listProgrammes, dueAcrossFlocks } from '@/lib/health-service';
import { withdrawalsAcrossFlocks } from '@/lib/withdrawal-service';
import { StatusBadge } from './StatusBadge';
import { StatusChip } from './ScheduleList';
import { scheduleSentence } from '@/lib/health-schedule';

export const metadata: Metadata = { title: 'Health' };

export default async function HealthPage() {
  const { principal, allowed } = await pageGuard('health:view');
  if (!allowed) return <Forbidden area="health records" roles={principal.roles} />;

  const [programmes, due, restricted, canCreate] = await Promise.all([
    listProgrammes(principal),
    dueAcrossFlocks(principal),
    withdrawalsAcrossFlocks(principal),
    currentUserCan('health:create'),
  ]);

  const overdue = due.filter((d) => d.entry.status === 'OVERDUE');

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Health programmes</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            What a flock is due, and when — keyed to age in days.
          </p>
        </div>
        {canCreate ? (
          <Link
            href="/health/new"
            className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
          >
            New programme
          </Link>
        ) : null}
      </div>

      {restricted.length > 0 ? (
        <section
          role="alert"
          className="mt-6 rounded-card border border-status-critical bg-status-critical-bg p-5 sm:p-6"
        >
          <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-status-critical">
            Withdrawal periods in force
          </h2>
          <ul className="mt-3 space-y-2">
            {restricted.map((f) => (
              <li key={f.flockId} className="text-[15px] text-status-critical">
                <Link
                  href={`/flocks/${f.flockId}/health`}
                  className="font-semibold underline underline-offset-2"
                >
                  {f.houseName ?? f.flockCode}
                </Link>{' '}
                — {f.eggsClearOn ? `eggs until ${f.eggsClearOn.toISOString().slice(0, 10)}` : ''}
                {f.eggsClearOn && f.meatClearsOn ? ', ' : ''}
                {f.meatClearsOn ? `meat until ${f.meatClearsOn.toISOString().slice(0, 10)}` : ''}
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-status-critical/30 pt-2.5 text-[13px] text-status-critical">
            Nothing from these flocks may be sold until the dates above.
          </p>
        </section>
      ) : null}

      {due.length > 0 ? (
        <section className="mt-6 rounded-card border border-border-default bg-surface-card p-5 sm:p-6">
          <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-accent">
            Due now
          </h2>
          <p className="mt-2 text-[13px] text-text-secondary">
            Across every open flock, most overdue first — the farm has one pair of hands.
          </p>
          <ul className="mt-4 divide-y divide-border-default">
            {due.map((d) => (
              <li
                key={`${d.flockId}-${d.entry.item.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5"
              >
                <Link
                  href={`/flocks/${d.flockId}/health`}
                  className="text-[15px] font-semibold text-text-primary hover:text-brand-primary"
                >
                  {d.houseName ?? d.flockCode}
                </Link>
                <span className="text-[15px] text-text-primary">{d.entry.item.name}</span>
                <StatusChip status={d.entry.status} />
                <span className="w-full text-[13px] text-text-secondary sm:ml-auto sm:w-auto">
                  {scheduleSentence(d.entry)}
                </span>
              </li>
            ))}
          </ul>
          {overdue.length > 0 ? (
            <p className="mt-3 border-t border-border-default pt-3 text-[13px] text-status-critical">
              {overdue.length} of these {overdue.length === 1 ? 'is' : 'are'} past the window
              the programme allows.
            </p>
          ) : null}
        </section>
      ) : null}

      <p className="mt-6 rounded-control border-l-2 border-brand-accent bg-surface-sunken px-4 py-3 text-[14px] text-text-secondary">
        <strong className="font-semibold text-text-primary">
          This system supplies no schedule of its own.
        </strong>{' '}
        Every entry comes from your veterinarian, your hatchery or your breed&apos;s
        management guide. What it does is the arithmetic — turning ages into dates, noticing
        what is due, and keeping track of withdrawal periods.
      </p>

      {programmes.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border-strong bg-surface-card p-10 text-center">
          <h2 className="text-lg font-semibold text-text-primary">No programme yet</h2>
          <p className="mx-auto mt-2 max-w-lg text-[15px] text-text-secondary">
            Ask whoever supplies your day-old chicks for their vaccination schedule — they
            will have one, and it accounts for what the chicks were already given at the
            hatchery. Paste it in and the reminders start working straight away, marked as
            provisional until a vet has reviewed it.
          </p>
          {canCreate ? (
            <Link
              href="/health/new"
              className="mt-6 inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
            >
              Start a programme
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-border-default overflow-hidden rounded-card border border-border-default bg-surface-card">
          {programmes.map((p) => (
            <li key={p.id} className="px-4 py-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                <Link
                  href={`/health/${p.id}`}
                  className="text-[16px] font-semibold text-text-primary underline-offset-2 hover:text-brand-primary hover:underline"
                >
                  {p.name}
                </Link>
                <StatusBadge status={p.status} />
                <span className="ml-auto text-[13px] text-text-secondary">
                  {p._count.items} entr{p._count.items === 1 ? 'y' : 'ies'}
                  {p._count.animalGroups > 0
                    ? ` · ${p._count.animalGroups} flock${p._count.animalGroups === 1 ? '' : 's'}`
                    : ''}
                </span>
              </div>
              <p className="mt-1 text-[13px] text-text-secondary">
                {p.sourceName
                  ? `From ${p.sourceName}${p.sourceRole ? `, ${p.sourceRole}` : ''}`
                  : 'Source not recorded'}
                {p.approvedByName ? ` · reviewed by ${p.approvedByName}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
