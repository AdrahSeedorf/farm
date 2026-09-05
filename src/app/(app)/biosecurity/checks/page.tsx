import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { recentChecks, openFailures, listChecklists } from '@/lib/checklist-service';

export const metadata: Metadata = { title: 'Inspections' };

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function ChecksPage() {
  const { principal, allowed } = await pageGuard('biosecurity:view');
  if (!allowed) return <Forbidden area="inspections" roles={principal.roles} />;

  const [checks, open, checklists, canCreate, canManage] = await Promise.all([
    recentChecks(principal),
    openFailures(principal),
    listChecklists(principal),
    currentUserCan('biosecurity:create'),
    currentUserCan('biosecurity:manage'),
  ]);

  const usable = checklists.filter((c) => c.isActive && c.items.length > 0);

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <Link href="/biosecurity" className="text-[14px] font-semibold text-brand-primary">
        ← Biosecurity
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Inspections</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            What somebody found when they walked the farm.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage ? (
            <Link
              href="/biosecurity/checklists"
              className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-4 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
            >
              Checklists
            </Link>
          ) : null}
          {canCreate && usable.length > 0 ? (
            <Link
              href="/biosecurity/checks/new"
              className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
            >
              Walk a checklist
            </Link>
          ) : null}
        </div>
      </div>

      {usable.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border-strong bg-surface-card p-8 text-center">
          <h2 className="text-lg font-semibold text-text-primary">No checklist yet</h2>
          <p className="mx-auto mt-2 max-w-lg text-[15px] text-text-secondary">
            An inspection needs something to inspect against. Build a checklist first — the
            screen offers a set of common starting points you can change, and whoever buys
            your eggs may well have their own list worth adding to it.
          </p>
          {canManage ? (
            <Link
              href="/biosecurity/checklists/new"
              className="mt-6 inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
            >
              Build a checklist
            </Link>
          ) : null}
        </div>
      ) : null}

      {/*
        The last inspection's failures, not every failure ever found. A fence
        mended in March should not still be shouting in September — the way a
        farm says it was mended is by walking the list again.
      */}
      {open.length > 0 ? (
        <section className="mt-8 rounded-card border border-status-critical bg-status-critical-bg p-5">
          <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-status-critical">
            Failed at the last inspection
          </h2>
          {open.map((o) => (
            <div key={o.checkId} className="mt-3">
              <p className="text-[13px] text-status-critical">
                {o.siteName} · {day(o.performedOn)}
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {o.failures.map((f) => (
                  <li key={f.key} className="text-[15px] text-status-critical">
                    <strong className="font-semibold">{f.label}</strong>
                    {f.note ? ` — ${f.note}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="mt-3 border-t border-status-critical/30 pt-2.5 text-[13px] text-status-critical">
            These stay here until the next inspection answers them.
          </p>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-text-muted">
          Recent
        </h2>
        {checks.length === 0 ? (
          <p className="mt-2.5 rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-[15px] text-text-secondary">
            Nothing recorded yet.
          </p>
        ) : (
          <ul className="mt-2.5 divide-y divide-border-default overflow-hidden rounded-card border border-border-default bg-surface-card">
            {checks.map((c) => (
              <li key={c.id} className="px-4 py-3.5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    href={`/biosecurity/checks/${c.id}`}
                    className="text-[15px] font-semibold text-text-primary underline-offset-2 hover:text-brand-primary hover:underline"
                  >
                    {c.checklistName}
                  </Link>
                  <span className="text-[13px] text-text-secondary">{c.siteName}</span>
                  <span className="ml-auto text-[13px] tabular-nums text-text-muted">
                    {day(c.performedOn)}
                  </span>
                </div>
                <p
                  className={`mt-0.5 text-[13px] ${
                    c.summary.failed > 0 ? 'font-medium text-status-critical' : 'text-text-secondary'
                  }`}
                >
                  {c.sentence}
                  {c.summary.scorePct !== null ? ` · ${c.summary.scorePct.toFixed(0)}%` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
