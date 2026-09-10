import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePrincipal } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { permissionsFor } from '@/lib/rbac';
import { farmTotals } from '@/lib/flock-service';
import { MAX_PARK_DAYS, thresholdInBirdsSentence } from '@/lib/alerts';
import { FarmMortalityForm, StageMortalityForm, RecordHourForm } from './ThresholdForms';

export const metadata: Metadata = { title: 'Alert thresholds' };

/**
 * Where the alert thresholds live.
 *
 * TWO PERMISSIONS, NOT ONE, AND THAT IS THE WHOLE DESIGN OF THIS PAGE.
 *
 *   How much death is ordinary is a veterinary judgement. The vet role in this
 *   system holds no `settings:*` permission at all — quite reasonably, since a
 *   vet has no business changing the business name — so putting the mortality
 *   figures behind the settings gate would have meant the one person qualified
 *   to set them could not, and the owner would be typing in numbers read down a
 *   phone. Those sections are guarded on `health:approve`, which owner, manager
 *   and vet hold.
 *
 *   The record cut-off is farm administration, not clinical, and stays with
 *   `settings:manage`.
 *
 *   Everything here is audited. A threshold quietly raised in March is the
 *   reason nobody was warned in April, and the log is how that is found out.
 */
export default async function AlertSettingsPage() {
  const principal = await requirePrincipal();
  const held = permissionsFor(principal);

  const canSeeClinical = held.has('health:view');
  const canEditClinical = held.has('health:approve');
  const canEditFarm = held.has('settings:manage');

  if (!canSeeClinical && !canEditFarm) {
    return <Forbidden area="alert thresholds" roles={principal.roles} />;
  }

  const [org, stages, totals] = await Promise.all([
    db.organisation.findUnique({
      where: { id: principal.organisationId },
      select: {
        recordDueHour: true,
        mortalityAttentionPct: true,
        mortalityCriticalPct: true,
        mortalitySpikeMultiple: true,
        mortalitySpikeFloorDeaths: true,
      },
    }),
    db.lifecycleStage.findMany({
      where: { productionType: { speciesProfile: { organisationId: principal.organisationId } } },
      orderBy: [{ productionTypeProfileId: 'asc' }, { sequence: 'asc' }],
      select: {
        id: true,
        name: true,
        typicalStartAgeDays: true,
        typicalEndAgeDays: true,
        mortalityAttentionPct: true,
        mortalityCriticalPct: true,
        productionType: { select: { name: true } },
      },
    }),
    farmTotals(principal),
  ]);

  if (!org) return <Forbidden area="alert thresholds" roles={principal.roles} />;

  // SCALED AGAINST THE REAL FLOCK WHERE THERE IS ONE. A percentage nobody can
  // picture is a percentage nobody notices is wrong; with no birds placed yet
  // the forms say so rather than scaling against an invented number.
  const population = totals.alive;

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/settings" className="text-[14px] font-semibold text-brand-primary">
        ← Settings
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Alert thresholds</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        The lines the alert list compares against.{' '}
        <Link href="/alerts/rules" className="font-semibold text-brand-primary hover:underline">
          What each rule watches
        </Link>
        .
      </p>

      {/* SAID PLAINLY, ON THE SCREEN, NOT ONLY IN A COMMENT. Somebody changing
          these needs to know the shipped figures were a starting point rather
          than advice from anyone qualified to give it. */}
      <p className="mt-5 rounded-control border border-border-strong bg-surface-sunken px-4 py-3 text-[14px] text-text-primary">
        The figures this system shipped with came from published breed material and are a
        starting point, not veterinary advice. Nothing here changes them on its own, and no
        alert built from them suggests a cause or a treatment — each one reports that a number
        crossed a line somebody set, and names whose line it was.
      </p>

      {canSeeClinical ? (
        <section className="mt-8 rounded-card border border-border-default bg-surface-card p-6">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
            Deaths — the farm figures
          </h2>
          <p className="mt-2 text-[14px] text-text-secondary">
            Used for any stage that has none of its own. Set the per-stage figures below
            instead wherever you can — a brooding chick and a hen in lay are not comparable,
            and one figure for both is wrong at one end.
          </p>

          <div className="mt-5">
            {canEditClinical ? (
              <FarmMortalityForm
                defaults={{
                  mortalityAttentionPct: org.mortalityAttentionPct,
                  mortalityCriticalPct: org.mortalityCriticalPct,
                  mortalitySpikeMultiple: org.mortalitySpikeMultiple,
                  mortalitySpikeFloorDeaths: org.mortalitySpikeFloorDeaths,
                }}
                population={population}
              />
            ) : (
              <dl className="space-y-3 text-[15px]">
                <div>
                  <dt className="text-text-secondary">Needs attention at</dt>
                  <dd className="font-semibold text-text-primary">
                    {org.mortalityAttentionPct}% a day —{' '}
                    {thresholdInBirdsSentence(org.mortalityAttentionPct, population)}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-secondary">Deal with today at</dt>
                  <dd className="font-semibold text-text-primary">
                    {org.mortalityCriticalPct}% a day —{' '}
                    {thresholdInBirdsSentence(org.mortalityCriticalPct, population)}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-secondary">A spike is</dt>
                  <dd className="font-semibold text-text-primary">
                    {org.mortalitySpikeMultiple}× the last seven days, and never fewer than{' '}
                    {org.mortalitySpikeFloorDeaths} birds
                  </dd>
                </div>
                <p className="pt-2 text-[13px] text-text-muted">
                  Changing these needs the permission to approve health records — your vet, or
                  whoever runs the farm.
                </p>
              </dl>
            )}
          </div>
        </section>
      ) : null}

      {canSeeClinical && stages.length > 0 ? (
        <section className="mt-8 rounded-card border border-border-default bg-surface-card p-6">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
            Deaths — by stage of life
          </h2>
          <p className="mt-2 text-[14px] text-text-secondary">
            Leave a box blank to use the farm figure. Week-one losses of around a percent are
            ordinary in a brooder and would be an outbreak in a laying house, which is why
            these are separate.
          </p>

          <ul className="mt-5 divide-y divide-border-default">
            {stages.map((stage) => (
              <li key={stage.id} className="py-5 first:pt-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="text-[15px] font-bold text-text-primary">{stage.name}</h3>
                  <span className="text-[13px] text-text-muted">
                    {stage.productionType.name}
                    {stage.typicalStartAgeDays !== null
                      ? ` · day ${stage.typicalStartAgeDays}${
                          stage.typicalEndAgeDays !== null ? `–${stage.typicalEndAgeDays}` : ' on'
                        }`
                      : ''}
                  </span>
                </div>

                {canEditClinical ? (
                  <StageMortalityForm
                    stage={{
                      id: stage.id,
                      name: stage.name,
                      attentionPct: stage.mortalityAttentionPct,
                      criticalPct: stage.mortalityCriticalPct,
                    }}
                    population={population}
                  />
                ) : (
                  <p className="mt-1.5 text-[14px] text-text-secondary">
                    {stage.mortalityCriticalPct === null
                      ? 'Uses the farm figures.'
                      : `Attention at ${stage.mortalityAttentionPct ?? org.mortalityAttentionPct}%, deal with today at ${stage.mortalityCriticalPct}%.`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-8 rounded-card border border-border-default bg-surface-card p-6">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
          The daily record
        </h2>
        <p className="mt-2 text-[14px] text-text-secondary">
          When a house with nothing written down becomes worth mentioning.
        </p>
        <div className="mt-5">
          {canEditFarm ? (
            <RecordHourForm defaultHour={org.recordDueHour} />
          ) : (
            <p className="text-[15px] text-text-primary">
              Records are due by{' '}
              <span className="font-semibold">{org.recordDueHour}:00</span>. Changing this
              needs the permission to manage settings.
            </p>
          )}
        </div>
      </section>

      <p className="mt-8 border-t border-border-default pt-4 text-[13px] text-text-muted">
        Every change here is written to the audit log with your name against it. Alerts
        themselves are never stored — changing a threshold changes what the next page load
        says, with nothing to rebuild. An alert somebody has parked stays parked until the
        date they chose, at most {MAX_PARK_DAYS} days.
      </p>
    </main>
  );
}
