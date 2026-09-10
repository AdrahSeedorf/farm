import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND, whatsappOrderLink, telLink, formatGhanaPhone } from '@/lib/brand';
import { siteFacts } from '@/lib/public-site-service';
import {
  headlineFor,
  supplySentence,
  supplyMonth,
  orderSteps,
  locationLine,
} from '@/lib/public-site';

/**
 * The homepage.
 *
 * REVALIDATED, NOT REBUILT. The page is static between revalidations, so a
 * customer on mobile data gets HTML off the edge rather than a database round
 * trip — and it still changes on its own when the farm does, because what it
 * says is derived. An hour is short enough that first lay is announced the same
 * morning it happens and long enough that a link shared in a WhatsApp group
 * cannot become a load test.
 */
export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const facts = await siteFacts();
  return {
    title: `${BRAND.name} — ${headlineFor(facts.state)}`,
    description: supplySentence(facts.state, facts.expectedFirstLay),
  };
}

export default async function HomePage() {
  const facts = await siteFacts();
  const { state, contact } = facts;
  const steps = orderSteps(state, contact);
  const where = locationLine();
  const month = supplyMonth(facts.expectedFirstLay);

  return (
    <main>
      {/* ---------------------------------------------------------------- */}
      {/* HERO. No photograph, and that is a decision rather than a gap: the
          farm has none of itself yet, and a stock image of somebody else's
          hens is the first thing a buyer who knows poultry would spot. Type,
          space and a real location do the work until there are real pictures,
          and the slot for them is the block below. */}
      <section className="border-b border-border-default bg-brand-primary">
        <div className="mx-auto max-w-5xl px-5 py-16 sm:py-24">
          {where ? (
            <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-brand-accent-on-dark">
              {where}
            </p>
          ) : null}

          <h1 className="mt-3 max-w-2xl text-[38px] font-bold leading-[1.1] tracking-tight text-text-inverse sm:text-[52px]">
            {headlineFor(state)}
          </h1>

          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-brand-primary-soft">
            {supplySentence(state, facts.expectedFirstLay)}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {/* CTAs IN THE SPECIFICATION'S PRIORITY ORDER — WhatsApp, call,
                wholesale — but only the ones that would actually work. A
                button that opens WhatsApp to a number nobody owns is worse
                than no button, because the customer blames themselves once
                and the farm every time after. */}
            {contact.canWhatsApp ? (
              <a
                href={whatsappOrderLink({})}
                className="inline-flex min-h-touch items-center rounded-control bg-brand-accent px-6 text-[16px] font-bold text-text-primary hover:brightness-105"
              >
                Order on WhatsApp
              </a>
            ) : null}

            {contact.canCall ? (
              <a
                href={telLink()}
                className="inline-flex min-h-touch items-center rounded-control border border-brand-accent-on-dark px-6 text-[16px] font-bold text-brand-accent-on-dark hover:bg-white/5"
              >
                Call {formatGhanaPhone(BRAND.contact.salesPhone)}
              </a>
            ) : null}

            <Link
              href="/wholesale"
              className={`inline-flex min-h-touch items-center rounded-control px-6 text-[16px] font-bold ${
                contact.canWhatsApp || contact.canCall
                  ? 'border border-brand-accent-on-dark text-brand-accent-on-dark hover:bg-white/5'
                  : 'bg-brand-accent text-text-primary hover:brightness-105'
              }`}
            >
              Request a wholesale quote
            </Link>

            <Link
              href="/products"
              className="inline-flex min-h-touch items-center rounded-control px-4 text-[16px] font-semibold text-brand-primary-soft hover:text-text-inverse"
            >
              What we produce →
            </Link>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* WHAT WE PRODUCE */}
      <section className="mx-auto max-w-5xl px-5 py-14">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-accent">
          What we produce
        </h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          <div>
            <h3 className="text-[18px] font-bold text-text-primary">Table eggs</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-text-secondary">
              Collected and graded every morning, sold by the crate. Sizes are graded on the
              farm rather than mixed, so a crate is the crate you ordered.
            </p>
          </div>
          <div>
            <h3 className="text-[18px] font-bold text-text-primary">Reared from day-old</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-text-secondary">
              We brood and rear our own pullets rather than buying them at point of lay. Every
              bird’s weight, feed and vaccination history is recorded from the day it arrives.
            </p>
          </div>
          <div>
            <h3 className="text-[18px] font-bold text-text-primary">Wholesale supply</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-text-secondary">
              Standing weekly orders for shops, hotels and caterers, with an agreed price and a
              fixed collection day.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* HOW ORDERING WORKS. Three steps, and no payment step — see
          orderSteps(). How a customer pays has not been decided, and
          describing a method the farm cannot take is the same false promise
          as a headline about eggs that do not exist. */}
      <section className="border-y border-border-default bg-surface-card">
        <div className="mx-auto max-w-5xl px-5 py-14">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-accent">
            How ordering works
          </h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title}>
                <span className="text-[13px] font-bold text-brand-accent">
                  {index + 1}
                </span>
                <h3 className="mt-1 text-[17px] font-bold text-text-primary">{step.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-text-secondary">
                  {step.detail}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* WHY BUY FROM US — the trust signals the specification asks for, and
          every one of them is a thing the software can actually evidence
          rather than an adjective. */}
      <section className="mx-auto max-w-5xl px-5 py-14">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-accent">
          Why buy from us
        </h2>
        <div className="mt-6 grid gap-x-8 gap-y-7 sm:grid-cols-2">
          <div>
            <h3 className="text-[17px] font-bold text-text-primary">
              Every bird is on the record
            </h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-text-secondary">
              Placements, deaths, weights, feed and vaccinations are recorded daily and cannot
              be edited after the fact. If you ask what a flock was treated with and when, we
              can tell you.
            </p>
          </div>
          <div>
            <h3 className="text-[17px] font-bold text-text-primary">
              Withdrawal periods are enforced, not remembered
            </h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-text-secondary">
              After any treatment with a withdrawal period, produce from that house is blocked
              from sale by our own system until the period has run. It is not a note on a wall.
            </p>
          </div>
          <div>
            <h3 className="text-[17px] font-bold text-text-primary">Visitors are logged</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-text-secondary">
              Anyone entering the houses signs in, and the houses are cleaned and disinfected on
              a recorded schedule. Disease arrives on boots before it arrives anywhere else.
            </p>
          </div>
          <div>
            <h3 className="text-[17px] font-bold text-text-primary">You can come and look</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-text-secondary">
              {where
                ? `We are at ${where}, and buyers are welcome to visit by arrangement.`
                : 'Buyers are welcome to visit the farm by arrangement.'}{' '}
              A farm that will not show you its houses is telling you something.
            </p>
          </div>
        </div>
        <Link
          href="/quality"
          className="mt-7 inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-5 text-[15px] font-semibold text-text-primary hover:bg-surface-sunken"
        >
          How we keep the birds healthy
        </Link>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* WHOLESALE BLOCK */}
      <section className="border-y border-border-default bg-brand-accent-soft">
        <div className="mx-auto max-w-5xl px-5 py-14">
          <h2 className="text-[24px] font-bold text-text-primary">
            Buying by the crate, every week?
          </h2>
          <p className="mt-2 max-w-xl text-[16px] leading-relaxed text-text-secondary">
            {state === 'SELLING'
              ? 'Standing wholesale orders get an agreed price and a fixed collection day. Tell us how much and how often.'
              : `We are taking wholesale enquiries now, ahead of our first eggs${
                  month ? ` in ${month}` : ''
                }. Early supply goes to buyers who talked to us first.`}
          </p>
          <Link
            href="/wholesale"
            className="mt-6 inline-flex min-h-touch items-center rounded-control bg-brand-primary px-6 text-[16px] font-bold text-text-inverse hover:bg-brand-primary-hover"
          >
            Request a wholesale quote
          </Link>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* CONTACT */}
      <section className="mx-auto max-w-5xl px-5 py-14">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-accent">
          Find us
        </h2>
        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <div>
            {where ? (
              <p className="text-[17px] font-semibold text-text-primary">{where}</p>
            ) : null}
            <p className="mt-2 text-[15px] leading-relaxed text-text-secondary">
              Collection from the farm any morning, by arrangement. Delivery in the{' '}
              {BRAND.location.region || 'region'} can be arranged for standing orders.
            </p>
          </div>
          <div>
            <Link
              href="/contact"
              className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-6 text-[16px] font-bold text-text-inverse hover:bg-brand-primary-hover"
            >
              Send us an enquiry
            </Link>
            {contact.canEmail ? (
              <p className="mt-3 text-[15px] text-text-secondary">
                Or email{' '}
                <a
                  href={`mailto:${BRAND.contact.email}`}
                  className="font-semibold text-brand-primary hover:underline"
                >
                  {BRAND.contact.email}
                </a>
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
