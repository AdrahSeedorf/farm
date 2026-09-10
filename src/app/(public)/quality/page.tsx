import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { locationLine } from '@/lib/public-site';

export const metadata: Metadata = {
  title: 'Quality & biosecurity',
  description: `How ${BRAND.name} keeps its birds healthy and its records straight.`,
};

/**
 * Quality and biosecurity.
 *
 * EVERY CLAIM ON THIS PAGE IS ONE THE SOFTWARE ACTUALLY ENFORCES. That is the
 * rule this page is written to, and it is what separates it from the same page
 * on every other farm's site: "we take hygiene seriously" is an adjective, and
 * "produce from a treated house is blocked from sale by our own system until the
 * withdrawal period has run" is a thing that either happens or does not.
 *
 * NOTHING HERE IS A CERTIFICATION CLAIM. The farm holds no accreditation yet and
 * this page must never imply one — a buyer who assumes a standard the farm does
 * not hold is a complaint waiting to happen, and in some markets a legal
 * problem. What it describes is the farm's own practice, said as its own.
 */
export default function QualityPage() {
  const where = locationLine();

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <h1 className="text-[34px] font-bold leading-tight tracking-tight text-text-primary">
        Quality &amp; biosecurity
      </h1>
      <p className="mt-3 text-[17px] leading-relaxed text-text-secondary">
        Everything below is something we do and record, not something we intend to. If you
        want to check any of it, come and look.
      </p>

      <div className="mt-9 space-y-8">
        <section>
          <h2 className="text-[19px] font-bold text-text-primary">
            Withdrawal periods are enforced, not remembered
          </h2>
          <p className="mt-2 text-[15.5px] leading-relaxed text-text-secondary">
            When a house is treated with anything that carries a withdrawal period, our system
            blocks produce from that house from being sold until the period has run. It is not
            a note on a wall or a date somebody has to remember on a busy morning — the sale
            is refused.
          </p>
        </section>

        <section>
          <h2 className="text-[19px] font-bold text-text-primary">
            The bird count cannot be edited
          </h2>
          <p className="mt-2 text-[15.5px] leading-relaxed text-text-secondary">
            There is no field anywhere in our records where somebody can type how many birds
            are alive. The number is worked out from every placement, death, cull and sale
            ever recorded, and a correction is a new entry with a reason and a name against
            it. History is added to, never rewritten.
          </p>
        </section>

        <section>
          <h2 className="text-[19px] font-bold text-text-primary">
            Vaccinations run to a programme, on a schedule
          </h2>
          <p className="mt-2 text-[15.5px] leading-relaxed text-text-secondary">
            Each flock follows a written health programme keyed to the birds’ age, and the
            system flags a dose before it is due and again once it is late. What was given,
            when, by whom, and from which batch is on the record.
          </p>
        </section>

        <section>
          <h2 className="text-[19px] font-bold text-text-primary">Visitors sign in</h2>
          <p className="mt-2 text-[15.5px] leading-relaxed text-text-secondary">
            Anyone entering the houses is logged, with where they were before. Disease arrives
            on boots and tyres long before it arrives any other way, and a visitor book that
            is actually kept is the cheapest biosecurity a farm can buy.
          </p>
        </section>

        <section>
          <h2 className="text-[19px] font-bold text-text-primary">
            Houses are cleaned on a recorded schedule
          </h2>
          <p className="mt-2 text-[15.5px] leading-relaxed text-text-secondary">
            Cleaning and disinfection are logged per house against an interval we set, and a
            house that is overdue shows up on the morning screen rather than being noticed
            eventually.
          </p>
        </section>

        <section>
          <h2 className="text-[19px] font-bold text-text-primary">Deaths are watched daily</h2>
          <p className="mt-2 text-[15.5px] leading-relaxed text-text-secondary">
            Mortality is checked every day against a figure set for that stage of life, and
            separately against the last week’s average — because a flock whose losses have
            changed shape is worth looking at before the rate itself gets high. The figures
            are ours to set with veterinary advice, and they are not buried in software.
          </p>
        </section>
      </div>

      <section className="mt-10 rounded-card border border-border-default bg-surface-sunken p-6">
        <h2 className="text-[17px] font-bold text-text-primary">What we do not claim</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-text-secondary">
          We hold no third-party certification, and we will not imply one. What is described
          here is our own practice, kept to our own records, and open to any buyer who wants
          to see it.
        </p>
      </section>

      <div className="mt-9">
        <Link
          href="/wholesale"
          className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-6 text-[16px] font-bold text-text-inverse hover:bg-brand-primary-hover"
        >
          Talk to us about supply
        </Link>
        {where ? (
          <p className="mt-4 text-[14px] text-text-secondary">
            {where} — visits by arrangement.
          </p>
        ) : null}
      </div>
    </main>
  );
}
