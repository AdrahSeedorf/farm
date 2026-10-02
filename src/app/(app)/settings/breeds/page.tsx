import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { listBreedStandards } from '@/lib/breed-standards-service';

export const metadata: Metadata = { title: 'Breed standards' };

/**
 * Which breeds have figures and which do not.
 *
 * THE MISSING ONES COME FIRST AND SAY WHAT THEY COST. Every screen that judges a
 * flock against its breed — weight samples, production week by week — was built,
 * tested and showing a dash, because no breed had any figures in it. A listing
 * that showed a tidy table of six breeds with empty columns would hide exactly
 * that. So an empty breed says what is not being compared because of it.
 */
export default async function BreedStandardsPage() {
  const { principal, allowed } = await pageGuard('settings:view');
  if (!allowed) return <Forbidden area="settings" roles={principal.roles} />;

  const breeds = await listBreedStandards(principal);
  const inUse = breeds.filter((b) => b.flockCount > 0);
  const missing = inUse.filter((b) => b.weightPoints === 0 || b.layPoints === 0);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/settings" className="text-[14px] font-semibold text-brand-primary">
        ← Settings
      </Link>

      <h1 className="mt-3 text-2xl font-bold text-text-primary">Breed standards</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        The tables your flocks are judged against: what a bird of this breed should weigh at a
        given age, and how much it should be laying. Both come from the breeder&rsquo;s own
        management guide — nothing here is invented, and a breed with no table reports no
        comparison rather than being scored against a guess.
      </p>

      {missing.length > 0 ? (
        <p className="mt-5 rounded-control border border-status-attention bg-status-attention-bg px-4 py-3 text-[14px] text-status-attention">
          {missing.length === 1
            ? `${missing[0].name} has flocks on it and is missing a table, so those comparisons show a dash.`
            : `${missing.length} breeds in use are missing a table, so those comparisons show a dash.`}{' '}
          Download the guide from the breeder — it is free — and paste the two columns in.
        </p>
      ) : null}

      {breeds.length === 0 ? (
        <p className="mt-6 text-[14px] text-text-secondary">
          No breeds are set up yet. Add one in Settings first.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-border-default rounded-card border border-border-default bg-surface-card">
          {breeds.map((breed) => (
            <li key={breed.id} className="px-5 py-4">
              <Link href={`/settings/breeds/${breed.id}`} className="block">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-[15px] font-semibold text-text-primary">{breed.name}</p>
                  <p className="text-[13px] text-text-muted">
                    {breed.flockCount === 0
                      ? 'no flocks'
                      : `${breed.flockCount} ${breed.flockCount === 1 ? 'flock' : 'flocks'}`}
                  </p>
                </div>

                <dl className="mt-1.5 grid gap-x-5 gap-y-0.5 text-[13.5px] sm:grid-cols-2">
                  <div className="flex justify-between gap-3">
                    <dt className="text-text-secondary">Body weight</dt>
                    <dd
                      className={
                        breed.weightPoints > 0
                          ? 'tabular-nums text-text-primary'
                          : 'font-semibold text-status-attention'
                      }
                    >
                      {breed.weightPoints > 0
                        ? `${breed.weightPoints} points, day ${breed.weightRange!.fromDays}–${
                            breed.weightRange!.toDays
                          }`
                        : 'none'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-text-secondary">Lay curve</dt>
                    <dd
                      className={
                        breed.layPoints > 0
                          ? 'tabular-nums text-text-primary'
                          : 'font-semibold text-status-attention'
                      }
                    >
                      {breed.layPoints > 0
                        ? `${breed.layPoints} points, day ${breed.layRange!.fromDays}–${
                            breed.layRange!.toDays
                          }`
                        : 'none'}
                    </dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-7 text-[13px] text-text-muted">
        Every layer breeder publishes these free: search for your breed&rsquo;s
        &ldquo;commercial management guide&rdquo;. They can also be loaded from a file on the
        command line with <code className="font-mono">npm run standards:load</code>, which is
        quicker for someone comfortable with a terminal and does exactly the same thing.
      </p>
    </main>
  );
}
