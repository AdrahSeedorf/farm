import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { terminologyFrom } from '@/lib/terminology';
import { GradeRow } from '../GradeRow';
import { GradeForm } from '../GradeForm';
import { addProductionGrade } from '../actions';

export const metadata: Metadata = { title: 'Grades' };

/**
 * The grades the farm sorts its output into.
 *
 * Grouped by production type rather than listed flat, because grades belong to
 * what is being produced: a farm running layers and broilers grades eggs and
 * grades carcasses, and the two lists have nothing to say to each other.
 *
 * The page guards itself. A worker who types this URL gets the same refusal as
 * one who never saw a link — hiding the link is a courtesy, never a control.
 */
export default async function GradesPage() {
  const { principal, allowed } = await pageGuard('settings:view');
  if (!allowed) return <Forbidden area="settings" roles={principal.roles} />;

  const canManage = await currentUserCan('settings:manage');

  const profiles = await db.productionTypeProfile.findMany({
    where: { speciesProfile: { organisationId: principal.organisationId } },
    orderBy: [{ speciesProfile: { name: 'asc' } }, { name: 'asc' }],
    include: {
      speciesProfile: { select: { name: true, terminology: true } },
      productionGrades: {
        orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }],
        include: { _count: { select: { lines: true } } },
      },
    },
  });

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/settings" className="text-[14px] font-semibold text-brand-primary">
        ← Settings
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Grades</h1>
      <p className="mt-2 text-[15px] text-text-secondary">
        How a collection is sorted when it is recorded, and which of those grades count as
        saleable. This list is the farm&rsquo;s, not the software&rsquo;s.
      </p>

      {profiles.map((profile) => {
        const words = terminologyFrom(profile.speciesProfile.terminology);
        const active = profile.productionGrades.filter((g) => g.isActive);
        const saleable = active.filter((g) => g.isSaleable).length;
        const unbanded = active.filter((g) => g.minGrams === null && g.maxGrams === null).length;

        return (
          <section
            key={profile.id}
            className="mt-6 rounded-card border border-border-default bg-surface-card p-6"
          >
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
              {profile.speciesProfile.name} · {profile.name}
            </h2>
            <p className="mt-2 text-[14px] text-text-secondary">
              {active.length} grade{active.length === 1 ? '' : 's'} in use, {saleable} of them
              saleable. {words.production} recorded against a retired grade stay exactly where
              they are.
            </p>

            {profile.productionGrades.length === 0 ? (
              <p className="mt-4 text-[15px] text-text-secondary">
                No grades yet. Add the first one below.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-border-default">
                {profile.productionGrades.map((grade) => (
                  <GradeRow
                    key={grade.id}
                    canManage={canManage}
                    grade={{
                      id: grade.id,
                      key: grade.key,
                      name: grade.name,
                      isSaleable: grade.isSaleable,
                      minGrams: grade.minGrams,
                      maxGrams: grade.maxGrams,
                      isActive: grade.isActive,
                      lineCount: grade._count.lines,
                    }}
                  />
                ))}
              </ul>
            )}

            {unbanded > 0 ? (
              <p className="mt-4 rounded-control border border-border-default bg-surface-sunken px-3.5 py-3 text-[13px] text-text-secondary">
                {unbanded} of these have no weight band set, so they are names people apply by
                eye. That is honest and it is how grading is done on most benches — but the day
                a buyer agrees bands with you, set them here so everyone sorts to the same line.
                No band is shipped with the software, for the same reason no breed weight curve
                is: a boundary nobody on this farm chose would still be trusted.
              </p>
            ) : null}

            {canManage ? (
              <div className="mt-6 border-t border-border-default pt-5">
                <h3 className="text-[15px] font-semibold text-text-primary">Add a grade</h3>
                <div className="mt-3">
                  <GradeForm
                    action={addProductionGrade.bind(null, profile.id)}
                    submitLabel="Add grade"
                    idPrefix={`new-${profile.id}`}
                  />
                </div>
              </div>
            ) : null}
          </section>
        );
      })}
    </main>
  );
}
