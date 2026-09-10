import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { db } from '@/lib/db';
import { BRAND } from '@/lib/brand';
import { siteFacts } from '@/lib/public-site-service';
import { locationLine, supplyMonth } from '@/lib/public-site';
import { photosFor, photoSrc } from '@/lib/farm-photos';

export const metadata: Metadata = {
  title: 'About us',
  description: `Who ${BRAND.name} are and where the farm is.`,
};

export const revalidate = 3600;

/**
 * About us.
 *
 * THE PAGE MOST LIKELY TO CONTAIN A LIE, and it is written to make that hard.
 *
 *   An About page is where a marketing site invents: a founder story, a number
 *   of years, a family history, a headcount. Every one of those is a claim a
 *   buyer may repeat back to the farm, and the farm has to live with it. So
 *   nothing here is generated and nothing is seeded. The story is whatever the
 *   owner has written on the settings screen, and where they have written
 *   nothing the page says less rather than filling the space.
 *
 *   What is left when the story is blank is still worth reading, because it is
 *   all true and all checkable: where the farm is, how many houses it has, what
 *   it rears and from what age, and where it is in its first cycle. Those come
 *   from the farm's own records rather than from copy.
 */
export default async function AboutPage() {
  const facts = await siteFacts();
  const where = locationLine();
  const month = supplyMonth(facts.expectedFirstLay);
  const photos = photosFor('about');

  const [org, houses, breeds] = await Promise.all([
    db.organisation.findFirst({ select: { aboutStory: true, foundedYear: true } }),
    db.productionUnit.count({ where: { isActive: true } }),
    db.animalGroup.findMany({
      where: { closedAt: null },
      select: { breedRef: { select: { name: true } } },
      distinct: ['breedId'],
    }),
  ]);

  const breedNames = breeds
    .map((b) => b.breedRef?.name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0);

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <h1 className="text-[34px] font-bold leading-tight tracking-tight text-text-primary">
        About {BRAND.name}
      </h1>
      {where ? (
        <p className="mt-2 text-[15px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
          {where}
        </p>
      ) : null}

      {/* THE OWNER'S OWN WORDS, or nothing. `whitespace-pre-line` keeps the
          paragraphs they typed; no markdown is parsed, because a settings box
          that silently turns an asterisk into a bullet is a box that surprises
          the person using it. */}
      {org?.aboutStory ? (
        <div className="mt-6 whitespace-pre-line text-[17px] leading-relaxed text-text-primary">
          {org.aboutStory}
        </div>
      ) : null}

      {photos.length > 0 ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {photos.map((photo) => (
            <figure key={photo.file}>
              <Image
                src={photoSrc(photo)}
                alt={photo.alt}
                width={800}
                height={600}
                sizes="(max-width: 640px) 100vw, 50vw"
                className="rounded-card"
              />
              {photo.caption ? (
                <figcaption className="mt-1.5 text-[13px] text-text-muted">
                  {photo.caption}
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      ) : null}

      {/* WHAT THE RECORDS SAY, which needs nobody to have written anything. */}
      <section className="mt-10 rounded-card border border-border-default bg-surface-card p-6">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-accent">
          The farm
        </h2>
        <dl className="mt-5 grid gap-5 sm:grid-cols-2">
          {where ? (
            <div>
              <dt className="text-[12px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                Where
              </dt>
              <dd className="mt-1 text-[16px] text-text-primary">{where}</dd>
            </div>
          ) : null}

          {org?.foundedYear ? (
            <div>
              <dt className="text-[12px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                Started
              </dt>
              <dd className="mt-1 text-[16px] text-text-primary">{org.foundedYear}</dd>
            </div>
          ) : null}

          {houses > 0 ? (
            <div>
              <dt className="text-[12px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                Houses
              </dt>
              <dd className="mt-1 text-[16px] text-text-primary">
                {houses} laying {houses === 1 ? 'house' : 'houses'}
              </dd>
            </div>
          ) : null}

          {breedNames.length > 0 ? (
            <div>
              <dt className="text-[12px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                Birds
              </dt>
              <dd className="mt-1 text-[16px] text-text-primary">
                {breedNames.join(', ')}, reared here from day-old
              </dd>
            </div>
          ) : null}

          <div>
            <dt className="text-[12px] font-semibold uppercase tracking-[0.1em] text-text-muted">
              Where we are in the cycle
            </dt>
            <dd className="mt-1 text-[16px] text-text-primary">
              {facts.state === 'SELLING'
                ? 'In lay, collecting and grading every morning.'
                : facts.state === 'BEFORE_FIRST_LAY'
                  ? `Rearing our first flock${month ? `, in lay from ${month}` : ''}.`
                  : 'Being set up.'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-[19px] font-bold text-text-primary">We rear our own birds</h2>
        <p className="mt-2 text-[16px] leading-relaxed text-text-secondary">
          Most small layer farms buy pullets at point of lay. We brood and rear ours from
          day-old instead. It is harder and it takes five months before the first egg, and it
          means every bird’s weight, feed, vaccinations and housing are on our own record from
          the day it arrived rather than on somebody else’s.
        </p>
        <p className="mt-3 text-[16px] leading-relaxed text-text-secondary">
          If you buy from us and ask what a flock was treated with and when, that is a question
          with an answer.
        </p>
        <Link
          href="/quality"
          className="mt-5 inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-5 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
        >
          How we keep the birds healthy
        </Link>
      </section>

      <section className="mt-10 border-t border-border-default pt-6">
        <h2 className="text-[19px] font-bold text-text-primary">Come and see it</h2>
        <p className="mt-2 text-[16px] leading-relaxed text-text-secondary">
          {where
            ? `We are at ${where}. Buyers are welcome to visit the houses by arrangement — we would rather you saw them before you committed to anything.`
            : 'Buyers are welcome to visit the houses by arrangement.'}
        </p>
        <Link
          href="/contact"
          className="mt-5 inline-flex min-h-touch items-center rounded-control bg-brand-primary px-6 text-[16px] font-bold text-text-inverse hover:bg-brand-primary-hover"
        >
          Arrange a visit
        </Link>
      </section>
    </main>
  );
}
