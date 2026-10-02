import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { programmeById, siteLatitudeNote } from '@/lib/lighting-service';
import { db } from '@/lib/db';
import { orgFilter, siteFilter } from '@/lib/scope';
import { duration, programmeWarnings, sortSteps, stepAt } from '@/lib/lighting';
import { LIGHTING_QUESTIONS, draftWarning } from '@/lib/draft-lighting';
import { SupplementModeForm, StepForm, RemoveStepButton } from '../ProgrammeForms';
import { UseThisButton } from './UseThisButton';

export const metadata: Metadata = { title: 'Lighting programme' };

/**
 * One programme, and the questions it cannot answer for itself.
 *
 * THE QUESTIONS ARE ON THE PAGE, not behind a link, while the programme is a
 * draft. A list of numbers nobody has checked looks exactly like a list of
 * numbers somebody has checked, and the only thing that distinguishes them on
 * screen is whether the page says so loudly enough to be read.
 */
export default async function LightingProgrammePage({
  params,
}: {
  params: Promise<{ programmeId: string }>;
}) {
  const { principal, allowed } = await pageGuard('flock:view');
  if (!allowed) return <Forbidden area="lighting" roles={principal.roles} />;

  const { programmeId } = await params;
  const [programme, canEdit] = await Promise.all([
    programmeById(principal, programmeId),
    currentUserCan('flock:edit'),
  ]);
  if (!programme) notFound();

  const steps = sortSteps(programme.steps);
  const warnings = programmeWarnings(steps);

  // The laying target is whatever the last step asks for — which is what the
  // flock will actually be held at for most of its life.
  const layingTarget = steps.length > 0 ? steps[steps.length - 1].totalHours : null;

  const site = await db.site.findFirst({
    where: { ...orgFilter(principal), ...siteFilter(principal), isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });
  const costNote = site
    ? await siteLatitudeNote(principal, site.id, layingTarget)
    : 'No farm is set up yet, so the natural daylength cannot be worked out.';

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/lighting" className="text-[14px] font-semibold text-brand-primary">
        ← Lighting
      </Link>

      <h1 className="mt-3 text-2xl font-bold text-text-primary">{programme.name}</h1>
      {programme.description ? (
        <p className="mt-1 text-[15px] text-text-secondary">{programme.description}</p>
      ) : null}

      {programme.isDraft ? (
        <p className="mt-4 rounded-control border border-status-attention bg-status-attention-bg px-4 py-3 text-[14px] text-status-attention">
          {draftWarning()}
        </p>
      ) : null}

      {programme.sourceNote ? (
        <p className="mt-3 text-[13px] text-text-muted">{programme.sourceNote}</p>
      ) : null}

      {/* WHAT THIS LATITUDE COSTS, stated as a running cost rather than a
          setting, because that is what it is at 6°N. */}
      <p className="mt-5 rounded-control border border-border-strong bg-surface-sunken px-4 py-3 text-[14px] text-text-secondary">
        {costNote}
      </p>

      {!programme.isDefault && canEdit ? (
        <div className="mt-5">
          <UseThisButton programmeId={programme.id} />
        </div>
      ) : null}

      <section className="mt-8">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
          The steps
        </h2>
        <p className="mt-2 text-[13.5px] text-text-secondary">
          Each row is a change, not a value for every day. The instruction in force is the latest
          one the flock has reached.
        </p>

        {steps.length === 0 ? (
          <p className="mt-3 text-[14px] text-text-secondary">Nothing on it yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border-default rounded-card border border-border-default bg-surface-card">
            {steps.map((step) => (
              <li key={step.id} className="px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-[15px] font-semibold text-text-primary">
                    Day {step.ageDays}{' '}
                    <span className="font-normal text-text-muted">
                      (week {Math.floor(step.ageDays / 7)})
                    </span>
                  </p>
                  <p className="text-[15px] font-bold tabular-nums text-text-primary">
                    {duration(step.totalHours)}
                  </p>
                </div>
                <p className="mt-0.5 text-[13px] text-text-muted">
                  {step.lux !== null
                    ? `${step.lux} lux at bird height`
                    : 'Light level not measured'}
                </p>
                {step.note ? (
                  <p className="mt-1 text-[13.5px] text-text-secondary">{step.note}</p>
                ) : null}
                {canEdit ? (
                  <div className="mt-1.5">
                    <RemoveStepButton
                      stepId={step.id}
                      programmeId={programme.id}
                      ageDays={step.ageDays}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {warnings.length > 0 ? (
          <div className="mt-4 rounded-control border border-status-attention bg-status-attention-bg px-4 py-3">
            <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-status-attention">
              Worth a second look
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13.5px] text-status-attention">
              {warnings.map((w) => (
                <li key={`${w.field}:${w.message}`}>{w.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {canEdit ? (
        <>
          <section className="mt-9">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
              Add or correct a step
            </h2>
            <p className="mt-2 text-[13.5px] text-text-secondary">
              Saving a step for an age that already has one replaces it.
            </p>
            <div className="mt-4">
              <StepForm programmeId={programme.id} />
            </div>
          </section>

          <section className="mt-9">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
              How the extra hours are given
            </h2>
            <div className="mt-4">
              <SupplementModeForm
                programmeId={programme.id}
                current={programme.supplementMode}
              />
            </div>
          </section>
        </>
      ) : null}

      {programme.isDraft ? (
        <section className="mt-10 border-t border-border-default pt-6">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
            Ask the hatchery these, in this order
          </h2>
          <p className="mt-2 text-[13.5px] text-text-secondary">
            The first one decides whether the rest of this programme is even possible in your
            house.
          </p>
          <ol className="mt-4 space-y-4">
            {LIGHTING_QUESTIONS.map((q, i) => (
              <li key={q.question}>
                <p className="text-[14.5px] font-semibold text-text-primary">
                  {i + 1}. {q.question}
                </p>
                <p className="mt-0.5 text-[13px] text-text-muted">{q.why}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {steps.length > 0 ? (
        <p className="mt-8 text-[13px] text-text-muted">
          At the last step this programme holds the flock at{' '}
          {duration(stepAt(steps, 100000)!.totalHours)} for the rest of lay. Shortening it after
          that point is how a moult is induced — if that is ever done here, it should be
          deliberate.
        </p>
      ) : null}
    </main>
  );
}
