import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND, whatsappOrderLink } from '@/lib/brand';
import { siteFacts } from '@/lib/public-site-service';
import { supplyMonth } from '@/lib/public-site';

export const metadata: Metadata = {
  title: 'Products',
  description: `Table eggs from ${BRAND.name}, graded on the farm and sold by the crate.`,
};

export const revalidate = 3600;

/**
 * What the farm sells.
 *
 * NO PRICES ON THIS PAGE, AND NOT BECAUSE THEY ARE HARD TO RENDER.
 *
 *   The specification asks for "featured products with live prices", and that is
 *   the right page — once there is a price list, which is Milestone 15. Until
 *   then a number here would be a guess, and an egg price a customer read on a
 *   Tuesday and was quoted differently on the Wednesday costs more trust than
 *   the page was ever going to earn. A price appears when a price exists.
 *
 *   The size bands are the same: they come from the grades the farm sets up on
 *   its own settings screen, agreed with a buyer, and this software has no
 *   business inventing weight boundaries for eggs it has never seen. So the page
 *   describes what is sold and how it is graded, and says plainly that the
 *   figures come on request.
 */
export default async function ProductsPage() {
  const facts = await siteFacts();
  const month = supplyMonth(facts.expectedFirstLay);

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <h1 className="text-[34px] font-bold leading-tight tracking-tight text-text-primary">
        What we produce
      </h1>
      <p className="mt-3 text-[17px] leading-relaxed text-text-secondary">
        {facts.state === 'SELLING'
          ? 'Table eggs, collected and graded every morning and sold by the crate.'
          : `Table eggs, from ${month ?? 'our first flock coming into lay'}. Graded on the farm and sold by the crate.`}
      </p>

      <section className="mt-9 rounded-card border border-border-default bg-surface-card p-6 sm:p-8">
        <h2 className="text-[22px] font-bold text-text-primary">Table eggs</h2>
        <p className="mt-2 text-[15.5px] leading-relaxed text-text-secondary">
          Brown table eggs from our own flock, reared here from day-old. Collected and graded
          every morning, packed in crates of thirty.
        </p>

        <dl className="mt-6 grid gap-5 sm:grid-cols-2">
          <div>
            <dt className="text-[12px] font-semibold uppercase tracking-[0.1em] text-text-muted">
              Sold by
            </dt>
            <dd className="mt-1 text-[15px] text-text-primary">
              The crate of thirty. Trays and part-crates by arrangement.
            </dd>
          </div>
          <div>
            <dt className="text-[12px] font-semibold uppercase tracking-[0.1em] text-text-muted">
              Grading
            </dt>
            <dd className="mt-1 text-[15px] text-text-primary">
              Sorted by size on the farm rather than mixed, so a crate is the crate you
              ordered.
            </dd>
          </div>
          <div>
            <dt className="text-[12px] font-semibold uppercase tracking-[0.1em] text-text-muted">
              Price
            </dt>
            {/* SAID PLAINLY RATHER THAN LEFT BLANK. A missing price reads as a
                farm that has not thought about it; "on request, and held for the
                period we agree" reads as one that has. */}
            <dd className="mt-1 text-[15px] text-text-primary">
              On request. Wholesale prices are agreed for the period and held, not moved week
              to week.
            </dd>
          </div>
          <div>
            <dt className="text-[12px] font-semibold uppercase tracking-[0.1em] text-text-muted">
              Collection
            </dt>
            <dd className="mt-1 text-[15px] text-text-primary">
              From the farm any morning, by arrangement. Delivery for standing orders.
            </dd>
          </div>
        </dl>
      </section>

      <section className="mt-8 rounded-card border border-border-default bg-surface-sunken p-6">
        <h2 className="text-[17px] font-bold text-text-primary">Spent hens</h2>
        <p className="mt-1.5 text-[15px] leading-relaxed text-text-secondary">
          At the end of a laying cycle the flock is sold whole. If you buy birds, tell us now
          and we will come to you when the time comes rather than advertising it.
        </p>
      </section>

      <div className="mt-9 flex flex-wrap gap-3">
        <Link
          href="/wholesale"
          className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-6 text-[16px] font-bold text-text-inverse hover:bg-brand-primary-hover"
        >
          Ask for prices
        </Link>
        {facts.contact.canWhatsApp ? (
          <a
            href={whatsappOrderLink({ productName: 'Table eggs' })}
            className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-6 text-[16px] font-bold text-text-primary hover:bg-surface-sunken"
          >
            Order on WhatsApp
          </a>
        ) : null}
      </div>
    </main>
  );
}
