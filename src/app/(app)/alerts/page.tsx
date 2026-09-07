import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { permissionsFor } from '@/lib/rbac';
import { alertsFor } from '@/lib/alert-service';
import {
  RULE_CATALOGUE,
  ALERT_RULES,
  LEVEL_LABELS,
  alertSummary,
  groupAlerts,
  standingSentence,
  type AlertLevel,
} from '@/lib/alerts';

export const metadata: Metadata = { title: 'Alerts' };

/**
 * The alert list.
 *
 * THERE IS NO SINGLE PERMISSION ON THIS PAGE, and that is deliberate. Every rule
 * carries its own, so the page shows each reader the subset they hold: a worker
 * gets their overdue tasks and the deaths in their house, an owner gets all
 * fourteen rules, and neither is a different page. Guarding the route behind
 * `report:view` instead would have made the whole feature owner-only and left a
 * worker with no way to see the report they filed going unread.
 *
 * Somebody holding none of the fourteen permissions sees the same refusal as any
 * other closed area, rather than an empty list that reads as "nothing is wrong".
 */
const TONE: Record<AlertLevel, { border: string; text: string; chip: string }> = {
  CRITICAL: {
    border: 'border-status-critical bg-status-critical-bg',
    text: 'text-status-critical',
    chip: 'bg-status-critical text-text-inverse',
  },
  ATTENTION: {
    border: 'border-status-attention bg-status-attention-bg',
    text: 'text-status-attention',
    chip: 'bg-status-attention text-text-inverse',
  },
  NOTICE: {
    border: 'border-border-default bg-surface-card',
    text: 'text-text-secondary',
    chip: 'bg-surface-sunken text-text-secondary',
  },
};

export default async function AlertsPage() {
  const principal = await requirePrincipal();
  const held = permissionsFor(principal);

  // Which rules could ever reach this reader. Used for the refusal above and for
  // the "what is being watched" line below — a reader is told what they are NOT
  // being shown, in counts, because an alert list is only trustworthy if its
  // silences are legible.
  const readable = ALERT_RULES.filter((r) => held.has(RULE_CATALOGUE[r].permission));
  if (readable.length === 0) return <Forbidden area="alerts" roles={principal.roles} />;

  const now = new Date();
  const { alerts, failed } = await alertsFor(principal, now);
  const summary = alertSummary(alerts);
  const groups = groupAlerts(alerts);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Alerts</h1>
          <p
            className={`mt-1 text-[15px] ${
              summary.critical > 0
                ? 'font-medium text-status-critical'
                : summary.attention > 0
                  ? 'font-medium text-status-attention'
                  : 'text-text-secondary'
            }`}
          >
            {summary.sentence}
          </p>
        </div>
        <Link
          href="/alerts/rules"
          className="text-[14px] font-semibold text-brand-primary hover:underline"
        >
          What is being watched
        </Link>
      </div>

      {/* A READING THAT FAILED IS SAID OUT LOUD. A shorter list that looks
          complete is worse than an error, because the reader acts on it. */}
      {failed.length > 0 ? (
        <p
          role="alert"
          className="mt-5 rounded-control border border-status-critical bg-status-critical-bg px-3.5 py-3 text-[14px] font-medium text-status-critical"
        >
          {failed.length === 1 ? 'One check' : `${failed.length} checks`} could not be made just
          now, so this list is incomplete. Open the underlying screens directly rather than
          treating this page as the whole picture.
        </p>
      ) : null}

      {alerts.length === 0 ? (
        <section className="mt-8 rounded-card border border-border-default bg-surface-card p-6">
          <p className="text-[15px] font-medium text-text-primary">Nothing needs you.</p>
          <p className="mt-2 text-[14px] text-text-secondary">
            {readable.length} {readable.length === 1 ? 'check is' : 'checks are'} running against
            your farm — stock cover, the health programme, deaths, records, orders, tasks,
            reports and the clock. Nothing has crossed a line.{' '}
            <Link href="/alerts/rules" className="font-semibold text-brand-primary hover:underline">
              See what each one watches
            </Link>
            .
          </p>
        </section>
      ) : null}

      <div className="mt-8 space-y-5">
        {groups.map((group) => {
          const rule = RULE_CATALOGUE[group.rule];
          const tone = TONE[group.level];

          return (
            <section key={group.rule} className={`rounded-card border p-5 ${tone.border}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className={`text-[15px] font-bold ${tone.text}`}>{rule.label}</h2>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] ${tone.chip}`}
                >
                  {LEVEL_LABELS[group.level]}
                  {group.alerts.length > 1 ? ` · ${group.alerts.length}` : ''}
                </span>
              </div>

              <ul className="mt-3 divide-y divide-border-default">
                {group.alerts.map((alert) => {
                  const standing = standingSentence(alert, now);
                  return (
                    <li key={alert.key} className="py-3 first:pt-2">
                      <Link
                        href={alert.href}
                        className="text-[15px] font-semibold text-text-primary hover:text-brand-primary"
                      >
                        {alert.headline}
                      </Link>
                      <p className="mt-0.5 text-[14px] text-text-secondary">{alert.detail}</p>
                      {standing ? (
                        <p className="mt-0.5 text-[12.5px] text-text-muted">{standing}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {alerts.length > 0 ? (
        <p className="mt-8 border-t border-border-default pt-4 text-[13px] text-text-muted">
          Nothing here is stored. Every line is worked out from the records when this page
          loads, so a condition you deal with stops appearing without anyone marking it done.
        </p>
      ) : null}
    </main>
  );
}
