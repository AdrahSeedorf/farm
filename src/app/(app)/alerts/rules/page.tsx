import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { permissionsFor } from '@/lib/rbac';
import {
  ALERT_RULES,
  ALERT_LEVELS,
  RULE_CATALOGUE,
  LEVEL_LABELS,
  type AlertLevel,
} from '@/lib/alerts';

export const metadata: Metadata = { title: 'What is being watched' };

/**
 * The rule catalogue, in full.
 *
 * WHY THIS SCREEN EXISTS AT ALL.
 *   An alert list is only worth reading if its silences mean something. "Nothing
 *   needs you" is either the most useful sentence on the farm or a lie, and the
 *   only way to tell them apart is to be able to read what is actually being
 *   checked. A system that alerts without being able to say what it watches asks
 *   to be trusted on nothing.
 *
 *   It is also where somebody who disagrees with an alert finds out which number
 *   to go and change — the thresholds are the farm's, and a farm that cannot
 *   find them will eventually switch the whole list off instead.
 *
 * RULES THE READER CANNOT SEE ARE LISTED, AND SAID TO BE UNAVAILABLE.
 *   Naming the rule is not the leak; its contents are, and those never reach
 *   this page. Silently omitting them would leave a worker unable to tell "the
 *   farm is watching this and I am not shown it" from "nobody is watching this",
 *   which are very different things to believe on a Monday morning.
 */
const TONE: Record<AlertLevel, string> = {
  CRITICAL: 'text-status-critical',
  ATTENTION: 'text-status-attention',
  NOTICE: 'text-text-secondary',
};

export default async function AlertRulesPage() {
  const principal = await requirePrincipal();
  const held = permissionsFor(principal);

  const readable = ALERT_RULES.filter((r) => held.has(RULE_CATALOGUE[r].permission));
  if (readable.length === 0) return <Forbidden area="alerts" roles={principal.roles} />;

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/alerts" className="text-[14px] font-semibold text-brand-primary">
        ← Alerts
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">What is being watched</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        Every check this system makes. {readable.length} of {ALERT_RULES.length}{' '}
        {readable.length === 1 ? 'is' : 'are'} shown to your account; the rest run for people who
        hold that part of the farm.
      </p>

      {ALERT_LEVELS.map((level) => {
        const rules = ALERT_RULES.filter((r) => RULE_CATALOGUE[r].level === level);
        if (rules.length === 0) return null;

        return (
          <section key={level} className="mt-8">
            <h2
              className={`text-[12px] font-semibold uppercase tracking-[0.16em] ${TONE[level]}`}
            >
              {LEVEL_LABELS[level]}
            </h2>
            <ul className="mt-3 space-y-4">
              {rules.map((rule) => {
                const definition = RULE_CATALOGUE[rule];
                const visible = held.has(definition.permission);

                return (
                  <li
                    key={rule}
                    className="rounded-card border border-border-default bg-surface-card p-4"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <h3 className="text-[15px] font-bold text-text-primary">
                        {definition.label}
                      </h3>
                      {visible ? null : (
                        <span className="text-[12px] font-semibold text-text-muted">
                          Not shown to your account
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-[14px] text-text-primary">{definition.what}</p>
                    <p className="mt-1 text-[13.5px] text-text-secondary">{definition.why}</p>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <section className="mt-10 rounded-card border border-border-default bg-surface-card p-6">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-accent">
          Where the numbers come from
        </h2>
        <dl className="mt-4 space-y-4 text-[14px]">
          <div>
            <dt className="font-semibold text-text-primary">Deaths</dt>
            <dd className="mt-1 text-text-secondary">
              Deaths in a day as a percentage of the birds alive that morning, compared against
              a figure set for that stage of life — brooding, growing, laying and so on each
              have their own, because week-one losses that are ordinary in a brooder would be an
              outbreak in a laying house. The seeded figures are starting points taken from
              published breed material and are for your vet to revise. Culls are not counted:
              they are a decision somebody made, not a signal.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-text-primary">Stock</dt>
            <dd className="mt-1 text-text-secondary">
              Days of cover is the amount on hand divided by the last seven days’ rate of use,
              compared against how long that item’s own supplier takes to deliver. Four days of
              feed is comfortable with a next-day supplier and an emergency with a fortnightly
              one, so the comparison is never against a fixed number of days.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-text-primary">Everything else</dt>
            <dd className="mt-1 text-text-secondary">
              Dates. A vaccination is overdue when its window has closed, an order is late
              against the date agreed with the supplier rather than an average, a task is
              overdue against the date somebody put on it, and a report is unattended when
              nobody has recorded reading it.
            </dd>
          </div>
        </dl>
        <p className="mt-5 border-t border-border-default pt-4 text-[13px] text-text-muted">
          No alert here suggests a cause or a treatment. Each one reports that a number crossed
          a line somebody set, and names whose line it was.
        </p>
      </section>
    </main>
  );
}
