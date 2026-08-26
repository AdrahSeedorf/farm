import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { orgFilter, canAccessSite } from '@/lib/scope';
import {
  averageWeightGrams,
  uniformityCvPct,
  uniformityWithinTolerancePct,
  bodyWeightVsStandardPct,
  round,
} from '@/lib/metrics';
import { standardWeightAt, weightStandardFrom, assessUniformity } from '@/lib/rearing';
import { WeightForm } from '../../WeightForm';
import { recordWeightSample } from '../../actions';

export const metadata: Metadata = { title: 'Weights' };

const VERDICT_STYLE = {
  good: 'text-status-positive',
  watch: 'text-status-attention',
  poor: 'text-status-critical',
} as const;

export default async function WeightsPage({
  params,
}: {
  params: Promise<{ flockId: string }>;
}) {
  const { flockId } = await params;
  const { principal, allowed } = await pageGuard('production:view');
  if (!allowed) return <Forbidden area="production records" roles={principal.roles} />;

  const flock = await db.animalGroup.findFirst({
    where: { id: flockId, site: { ...orgFilter(principal) } },
    include: {
      productionType: { select: { standards: true } },
      weightSamples: {
        orderBy: [{ takenOn: 'desc' }],
        include: { recordedBy: { select: { name: true } } },
      },
    },
  });
  if (!flock) notFound();
  if (!canAccessSite(principal, flock.siteId)) notFound();

  const canRecord = await currentUserCan('production:create', flock.siteId);
  const standard = weightStandardFrom(flock.productionType.standards);
  const hasStandard = Object.keys(standard).length > 0;
  const today = new Date();

  const rows = flock.weightSamples.map((sample) => {
    const weights = sample.weightsGrams;
    const average =
      weights.length > 0 ? averageWeightGrams(weights) : (sample.averageGrams ?? null);
    const cv = weights.length > 1 ? uniformityCvPct(weights) : null;
    const within = weights.length > 1 ? uniformityWithinTolerancePct(weights, 10) : null;
    const target = standardWeightAt(sample.ageDays, standard);
    const vsStandard =
      average !== null && target !== null ? bodyWeightVsStandardPct(average, target) : null;

    return { sample, average, cv, within, target, vsStandard, verdict: assessUniformity(cv) };
  });

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <Link href={`/flocks/${flockId}`} className="text-[14px] font-semibold text-brand-primary">
        ← {flock.code}
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Weight &amp; uniformity</h1>
      <p className="mt-1 max-w-[62ch] text-[15px] text-text-secondary">
        Uniformity through rearing is the best predictor of how the laying cycle will go. A
        ragged flock comes into lay unevenly, peaks lower and holds peak for less time — and
        nothing done in the laying house afterwards fixes it.
      </p>

      {!hasStandard ? (
        <p className="mt-5 rounded-control border-l-2 border-status-attention bg-status-attention-bg px-4 py-3 text-[14px] text-[#6B4E12]">
          No breed standard loaded, so weights show without a target. The figures come from
          your breed&apos;s management guide — Isa, Lohmann, Hy-Line and Bovans all publish
          them. Loading them turns each sample into on target or behind.
        </p>
      ) : null}

      {canRecord ? (
        <section className="mt-7 rounded-card border border-border-default bg-surface-card p-5 sm:p-6">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
            Record a sample
          </h2>
          <div className="mt-4">
            <WeightForm
              action={recordWeightSample.bind(null, flockId)}
              today={today.toISOString().slice(0, 10)}
            />
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-bold text-text-primary">History</h2>
        {rows.length === 0 ? (
          <p className="mt-3 rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-center text-[15px] text-text-secondary">
            No samples yet. Weekly from the first week of rearing is the usual advice.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[38rem] border-collapse overflow-hidden rounded-card border border-border-default bg-surface-card">
              <thead>
                <tr className="border-b border-border-default">
                  {['Date', 'Age', 'Birds', 'Average', 'Uniformity', 'vs standard', 'By'].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ sample, average, cv, within, target, vsStandard, verdict }) => (
                  <tr key={sample.id} className="border-b border-border-default last:border-0">
                    <td className="tabular px-4 py-3 text-[14px] text-text-primary">
                      {sample.takenOn.toISOString().slice(0, 10)}
                    </td>
                    <td className="tabular px-4 py-3 text-[14px] text-text-secondary">
                      day {sample.ageDays}
                    </td>
                    <td className="tabular px-4 py-3 text-[14px] text-text-secondary">
                      {sample.sampleSize}
                    </td>
                    <td className="tabular px-4 py-3 text-[15px] font-semibold text-text-primary">
                      {average === null ? '—' : `${round(average, 0)} g`}
                    </td>
                    <td className="tabular px-4 py-3 text-[14px]">
                      {cv === null ? (
                        <span className="text-text-muted">average only</span>
                      ) : (
                        <>
                          <span className={`font-semibold ${verdict ? VERDICT_STYLE[verdict] : ''}`}>
                            {round(cv, 1)}% CV
                          </span>
                          {within !== null ? (
                            <span className="ml-2 text-text-muted">
                              {' · '}
                              {round(within, 0)}% within ±10%
                            </span>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="tabular px-4 py-3 text-[14px]">
                      {vsStandard === null ? (
                        <span className="text-text-muted">—</span>
                      ) : (
                        <>
                          <span
                            className={`font-semibold ${
                              vsStandard >= 97 && vsStandard <= 110
                                ? 'text-status-positive'
                                : 'text-status-attention'
                            }`}
                          >
                            {round(vsStandard, 0)}%
                          </span>
                          <span className="ml-1.5 text-text-muted">{' of '}{target} g</span>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-text-muted">
                      {sample.recordedBy.name}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 max-w-[62ch] text-[13px] text-text-muted">
          CV% is the sample&apos;s standard deviation divided by its mean — lower is more even.
          Under 10% is the usual target through rearing. The second figure is the share of birds
          within 10% of the sample average, which is how uniformity is often quoted in the field.
        </p>
      </section>
    </main>
  );
}
