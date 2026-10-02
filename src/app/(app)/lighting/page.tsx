import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { lightingToday, listProgrammes } from '@/lib/lighting-service';
import { clock, duration, MODE_LABELS } from '@/lib/lighting';
import { StartDraftLightingButton } from './StartDraftLightingButton';

export const metadata: Metadata = { title: 'Lighting' };

/**
 * What the lights should be doing, right now, in each house.
 *
 * THE SWITCH-ON TIME IS THE HEADLINE. Everything else on this screen — the
 * programme, the step, the natural daylength — is the reasoning behind one
 * instruction: be in the house at this time and press this switch. A screen that
 * led with the programme would be organised around how the software thinks
 * rather than around what somebody has to do at five in the morning.
 */
export default async function LightingPage() {
  const { principal, allowed } = await pageGuard('flock:view');
  if (!allowed) return <Forbidden area="lighting" roles={principal.roles} />;

  const [houses, programmes, canEdit] = await Promise.all([
    lightingToday(principal),
    listProgrammes(principal),
    currentUserCan('flock:edit'),
  ]);

  const active = programmes.filter((p) => p.isActive);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="text-2xl font-bold text-text-primary">Lighting</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        Daylength is what tells a hen to lay. Here it is about 12 hours all year, so a laying
        flock needs the difference made up with lamps — every day, not seasonally.
      </p>

      <section className="mt-7">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
          Today
        </h2>

        {houses.length === 0 ? (
          <p className="mt-3 text-[14px] text-text-secondary">
            There are no open flocks, so there is nothing to light.
          </p>
        ) : (
          <ul className="mt-3 space-y-4">
            {houses.map((house) => (
              <li
                key={house.flockId}
                className="rounded-card border border-border-default bg-surface-card p-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-[15px] font-bold text-text-primary">
                    {house.unitName ?? house.flockCode}
                  </p>
                  <p className="text-[13px] text-text-muted">
                    {house.flockCode} · week {house.ageWeeks}
                  </p>
                </div>

                {house.plan ? (
                  <>
                    <p
                      className={`mt-2 text-[15px] font-semibold ${
                        house.plan.belowNaturalHours > 0
                          ? 'text-status-attention'
                          : house.plan.supplementHours > 0
                            ? 'text-text-primary'
                            : 'text-text-secondary'
                      }`}
                    >
                      {house.plan.sentence}
                    </p>

                    <dl className="mt-3 grid gap-x-5 gap-y-1 text-[13.5px] sm:grid-cols-2">
                      <div className="flex justify-between gap-3">
                        <dt className="text-text-secondary">Programme asks for</dt>
                        <dd className="font-semibold tabular-nums text-text-primary">
                          {duration(house.plan.targetHours)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-text-secondary">The sky gives</dt>
                        <dd className="font-semibold tabular-nums text-text-primary">
                          {duration(house.plan.naturalHours)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-text-secondary">Sunrise / sunset</dt>
                        <dd className="tabular-nums text-text-primary">
                          {clock(house.sun!.sunriseMinutes)} / {clock(house.sun!.sunsetMinutes)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        {/* THE NUMBER WELFARE TURNS ON, so it is on the card
                            rather than buried in the programme. */}
                        <dt className="text-text-secondary">Dark</dt>
                        <dd className="tabular-nums text-text-primary">
                          {duration(house.plan.darkHours)}
                        </dd>
                      </div>
                    </dl>

                    {house.current?.lux ? (
                      <p className="mt-2 text-[13px] text-text-muted">
                        Target light level {house.current.lux} lux at bird height.
                      </p>
                    ) : (
                      <p className="mt-2 text-[13px] text-text-muted">
                        Nobody has stated a light level for this age, so this cannot say whether
                        the lamps are bright enough.
                      </p>
                    )}

                    {house.practicality ? (
                      <p className="mt-2 text-[13px] text-status-attention">
                        {house.practicality}
                      </p>
                    ) : null}

                    {house.upcoming ? (
                      <p className="mt-2 text-[13px] text-text-secondary">
                        Next change in {house.upcoming.inDays}{' '}
                        {house.upcoming.inDays === 1 ? 'day' : 'days'} — up to{' '}
                        {duration(house.upcoming.step.totalHours)} at day{' '}
                        {house.upcoming.step.ageDays}.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-2 text-[14px] text-status-attention">{house.note}</p>
                )}

                {house.isDraft && house.plan ? (
                  <p className="mt-3 border-t border-border-default pt-2.5 text-[13px] text-status-attention">
                    From an unchecked draft. Nobody qualified has looked at these numbers, and
                    stimulation should go on body weight rather than on the ages in it.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-9">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
            Programmes
          </h2>
          {canEdit && active.length === 0 ? <StartDraftLightingButton /> : null}
        </div>

        {active.length === 0 ? (
          <p className="mt-3 text-[14px] text-text-secondary">
            There is no lighting programme yet, so no house above can be told what to do. The
            draft is a starting point for the conversation with your hatchery — it is not a
            recommendation, and it is meant to be corrected.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border-default rounded-card border border-border-default bg-surface-card">
            {active.map((programme) => (
              <li key={programme.id} className="px-5 py-4">
                <Link href={`/lighting/${programme.id}`} className="block">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-[15px] font-semibold text-text-primary">{programme.name}</p>
                    {programme.isDefault ? (
                      <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-brand-primary">
                        In use
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[13.5px] text-text-secondary">
                    {programme.steps.length}{' '}
                    {programme.steps.length === 1 ? 'instruction' : 'instructions'} ·{' '}
                    {MODE_LABELS[programme.supplementMode].toLowerCase()}
                    {programme.productionTypeName ? ` · ${programme.productionTypeName}` : ''}
                  </p>
                  {programme.isDraft ? (
                    <p className="mt-1 text-[13px] text-status-attention">
                      Unchecked draft — nobody qualified has looked at it.
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
