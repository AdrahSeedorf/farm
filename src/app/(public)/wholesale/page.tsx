import type { Metadata } from 'next';
import { BRAND, whatsappOrderLink, telLink, formatGhanaPhone } from '@/lib/brand';
import { siteFacts } from '@/lib/public-site-service';
import { supplyMonth, locationLine } from '@/lib/public-site';
import { EnquiryForm } from './EnquiryForm';

export const metadata: Metadata = {
  title: 'Wholesale supply',
  description: `Standing weekly egg supply from ${BRAND.name}. Tell us how many crates and from when.`,
};

export const revalidate = 3600;

/**
 * Wholesale.
 *
 * THE MOST IMPORTANT PAGE ON THIS SITE, and it will stay so for months. A layer
 * farm's first eggs arrive five months after the chicks do, and the farm that
 * has spent those months collecting buyers sells its first week's production
 * while the farm that waited is ringing round shops with crates in the van.
 * Everything here is arranged to get one message from one buyer.
 */
export default async function WholesalePage() {
  const facts = await siteFacts();
  const { state, contact } = facts;
  const month = supplyMonth(facts.expectedFirstLay);
  const where = locationLine();

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <h1 className="text-[34px] font-bold leading-tight tracking-tight text-text-primary">
        Wholesale supply
      </h1>
      <p className="mt-3 text-[17px] leading-relaxed text-text-secondary">
        {state === 'SELLING'
          ? 'Standing weekly orders with an agreed price and a fixed collection day. Tell us how much and how often, and we will come back with terms.'
          : `We are taking wholesale enquiries now, ahead of our first eggs${
              month ? ` in ${month}` : ''
            }. Nothing is committed on either side — it puts you first in line when we start.`}
      </p>

      {/* WHAT THEY GET, before what we want from them. A page that opens with a
          form is a page asking for something; this one answers "why would I"
          first, in three lines a buyer actually cares about. */}
      <ul className="mt-8 grid gap-5 sm:grid-cols-3">
        <li>
          <h2 className="text-[15px] font-bold text-text-primary">An agreed price</h2>
          <p className="mt-1 text-[14.5px] leading-relaxed text-text-secondary">
            Fixed for the period we agree, not moved on you week to week.
          </p>
        </li>
        <li>
          <h2 className="text-[15px] font-bold text-text-primary">A fixed day</h2>
          <p className="mt-1 text-[14.5px] leading-relaxed text-text-secondary">
            Your crates are set aside for the day you chose, graded and counted.
          </p>
        </li>
        <li>
          <h2 className="text-[15px] font-bold text-text-primary">A traceable flock</h2>
          <p className="mt-1 text-[14.5px] leading-relaxed text-text-secondary">
            We can tell you which house your eggs came from and what it was treated with.
          </p>
        </li>
      </ul>

      <section className="mt-10 rounded-card border border-border-default bg-surface-card p-6 sm:p-8">
        <h2 className="text-[20px] font-bold text-text-primary">Tell us what you need</h2>
        <p className="mt-1.5 text-[15px] text-text-secondary">
          Two boxes are required. The rest helps us answer properly.
        </p>
        <div className="mt-6">
          <EnquiryForm kind="WHOLESALE" submitLabel="Send enquiry" />
        </div>
      </section>

      {contact.canWhatsApp || contact.canCall ? (
        <section className="mt-8">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-accent">
            Or reach us directly
          </h2>
          <div className="mt-3 flex flex-wrap gap-3">
            {contact.canWhatsApp ? (
              <a
                href={whatsappOrderLink({})}
                className="inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-bold text-text-inverse hover:bg-brand-primary-hover"
              >
                WhatsApp us
              </a>
            ) : null}
            {contact.canCall ? (
              <a
                href={telLink()}
                className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-5 text-[15px] font-bold text-text-primary hover:bg-surface-sunken"
              >
                {formatGhanaPhone(BRAND.contact.salesPhone)}
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      {where ? (
        <p className="mt-8 border-t border-border-default pt-5 text-[14px] text-text-secondary">
          We are at {where}. Buyers are welcome to visit by arrangement — we would rather you
          saw the houses before you committed to anything.
        </p>
      ) : null}
    </main>
  );
}
