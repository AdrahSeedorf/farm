import type { Metadata } from 'next';
import { BRAND, whatsappOrderLink, telLink, formatGhanaPhone } from '@/lib/brand';
import { siteFacts } from '@/lib/public-site-service';
import { locationLine } from '@/lib/public-site';
import { EnquiryForm } from '../wholesale/EnquiryForm';

export const metadata: Metadata = {
  title: 'Contact',
  description: `How to reach ${BRAND.name}.`,
};

export const revalidate = 3600;

/**
 * Contact.
 *
 * THE FORM COMES FIRST, and the direct channels after it. That is the opposite
 * of most contact pages and it is deliberate: while the farm's phone lines are
 * unconfirmed the form is the only channel that certainly works, and a page that
 * leads with a number and buries the form would be leading with the thing most
 * likely to fail. When the numbers are set the ordering still holds — somebody
 * who wanted to ring has already rung.
 */
export default async function ContactPage() {
  const facts = await siteFacts();
  const { contact } = facts;
  const where = locationLine();

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <h1 className="text-[34px] font-bold leading-tight tracking-tight text-text-primary">
        Contact us
      </h1>
      <p className="mt-3 text-[17px] leading-relaxed text-text-secondary">
        Buying, visiting, or asking about supply — send us a message and somebody will come
        back to you.
      </p>

      <section className="mt-9 rounded-card border border-border-default bg-surface-card p-6 sm:p-8">
        <EnquiryForm kind="GENERAL" submitLabel="Send message" />
      </section>

      <div className="mt-9 grid gap-8 sm:grid-cols-2">
        {contact.canWhatsApp || contact.canCall || contact.canEmail ? (
          <section>
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-accent">
              Or reach us directly
            </h2>
            <div className="mt-3 flex flex-col items-start gap-3">
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
                  className="text-[16px] font-semibold text-brand-primary hover:underline"
                >
                  {formatGhanaPhone(BRAND.contact.salesPhone)}
                </a>
              ) : null}
              {contact.canEmail ? (
                <a
                  href={`mailto:${BRAND.contact.email}`}
                  className="text-[16px] font-semibold text-brand-primary hover:underline"
                >
                  {BRAND.contact.email}
                </a>
              ) : null}
            </div>
          </section>
        ) : null}

        {where ? (
          <section>
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-accent">
              Where we are
            </h2>
            <p className="mt-3 text-[16px] font-semibold text-text-primary">{where}</p>
            <p className="mt-1.5 text-[15px] leading-relaxed text-text-secondary">
              Collection from the farm any morning, by arrangement. Buyers are welcome to
              visit the houses — say so when you write and we will fix a time.
            </p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
