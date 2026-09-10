import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { listEnquiries } from '@/lib/enquiry-service';
import {
  stateOf,
  isUnanswered,
  sortEnquiries,
  enquirySentence,
  enquirySummary,
  wantsSentence,
  KIND_LABELS,
} from '@/lib/enquiries';
import { formatGhanaPhone } from '@/lib/brand';
import { ReadForm, AnswerForm, PutAsideForm } from './EnquiryForms';
import { ConvertEnquiryForm } from '../customers/CustomerForms';

export const metadata: Metadata = { title: 'Enquiries' };

/**
 * Who came looking.
 *
 * UNANSWERED FIRST, NEVER BIGGEST FIRST. The obvious sort is by crates a week
 * and it is the wrong one: that figure is what somebody typed before they had a
 * price, the small shop buying every week for three years is worth more than the
 * hotel that asked once, and a farm that visibly answers the big ones first is a
 * farm the small ones stop writing to.
 *
 * For the next five months this list IS the sales pipeline. Everything on the
 * screen is arranged to make an unanswered enquiry uncomfortable to look at.
 */
export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { principal, allowed } = await pageGuard('customer:view');
  if (!allowed) return <Forbidden area="enquiries" roles={principal.roles} />;

  const { archived } = await searchParams;
  const includeArchived = archived === '1';
  const now = new Date();

  const [enquiries, canAct, canAddBuyer] = await Promise.all([
    listEnquiries(principal, { includeArchived, asOf: now }),
    currentUserCan('customer:edit'),
    currentUserCan('customer:create'),
  ]);

  const sorted = sortEnquiries(enquiries, now);
  const late = enquiries.filter((e) => isUnanswered(e, now));

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Enquiries</h1>
          <p
            className={`mt-1 text-[15px] ${
              late.length > 0 ? 'font-medium text-status-critical' : 'text-text-secondary'
            }`}
          >
            {enquirySummary(enquiries, now)}
          </p>
        </div>
        <Link
          href={includeArchived ? '/enquiries' : '/enquiries?archived=1'}
          className="text-[14px] font-semibold text-brand-primary"
        >
          {includeArchived ? 'Hide put aside' : 'Show put aside'}
        </Link>
      </div>

      {enquiries.length === 0 ? (
        <section className="mt-8 rounded-card border border-border-default bg-surface-card p-6">
          <p className="text-[15px] font-medium text-text-primary">Nothing yet.</p>
          <p className="mt-2 text-[14px] text-text-secondary">
            Anyone who writes in through the website lands here. Until the first egg this is
            the whole sales pipeline, so it is worth checking daily —{' '}
            <Link href="/wholesale" className="font-semibold text-brand-primary hover:underline">
              see the form they fill in
            </Link>
            .
          </p>
        </section>
      ) : null}

      <ul className="mt-8 space-y-4">
        {sorted.map((enquiry) => {
          const state = stateOf(enquiry);
          const overdue = isUnanswered(enquiry, now);
          const wants = wantsSentence(enquiry);

          return (
            <li
              key={enquiry.id}
              className={`rounded-card border p-5 ${
                overdue
                  ? 'border-status-critical bg-status-critical-bg'
                  : state === 'ARCHIVED'
                    ? 'border-border-default bg-surface-sunken'
                    : 'border-border-default bg-surface-card'
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="text-[17px] font-bold text-text-primary">
                  {enquiry.name}
                  {enquiry.businessName ? (
                    <span className="font-normal text-text-secondary">
                      {' · '}
                      {enquiry.businessName}
                    </span>
                  ) : null}
                </h2>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] ${
                    enquiry.kind === 'WHOLESALE'
                      ? 'bg-brand-primary text-text-inverse'
                      : 'bg-surface-sunken text-text-secondary'
                  }`}
                >
                  {KIND_LABELS[enquiry.kind]}
                </span>
              </div>

              <p
                className={`mt-1 text-[14px] ${
                  overdue ? 'font-medium text-status-critical' : 'text-text-secondary'
                }`}
              >
                {enquirySentence(enquiry, now)}
              </p>

              {/* THE PHONE NUMBER IS A LINK. Whoever is reading this is about to
                  ring them, and on a phone that is one tap rather than a
                  transcription error. */}
              <p className="mt-3 text-[15px]">
                <a
                  href={`tel:${enquiry.phone}`}
                  className="font-semibold text-brand-primary hover:underline"
                >
                  {formatGhanaPhone(enquiry.phone)}
                </a>
                {enquiry.email ? (
                  <>
                    {' · '}
                    <a
                      href={`mailto:${enquiry.email}`}
                      className="text-text-secondary hover:text-brand-primary"
                    >
                      {enquiry.email}
                    </a>
                  </>
                ) : null}
              </p>

              {wants ? (
                <p className="mt-2 text-[15px] font-medium text-text-primary">{wants}</p>
              ) : null}

              {enquiry.message ? (
                <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-text-primary">
                  {enquiry.message}
                </p>
              ) : null}

              {enquiry.responseNote ? (
                <p className="mt-3 rounded-control border border-border-default bg-surface-sunken px-3 py-2 text-[14px] text-text-primary">
                  <span className="font-semibold">Told them:</span> {enquiry.responseNote}
                </p>
              ) : null}

              {canAct ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {state === 'NEW' ? <ReadForm enquiryId={enquiry.id} /> : null}
                  {state === 'NEW' || state === 'READ' ? (
                    <AnswerForm enquiryId={enquiry.id} />
                  ) : null}
                  {/* TURNING AN ENQUIRY INTO A BUYER IS OFFERED ONCE IT HAS
                      BEEN ANSWERED, not before. Somebody nobody has spoken to
                      is not yet a customer, and a buyers list padded with
                      people who never replied is one nobody trusts. */}
                  {state === 'ANSWERED' && canAddBuyer ? (
                    <ConvertEnquiryForm enquiryId={enquiry.id} />
                  ) : null}
                  {state !== 'ARCHIVED' ? <PutAsideForm enquiryId={enquiry.id} /> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="mt-8 border-t border-border-default pt-4 text-[13px] text-text-muted">
        Nothing here is ever deleted. An enquiry put aside stays on the record — it is still
        evidence of demand, and it is the first thing anybody will want when they ask next year
        why supply was committed the way it was.
      </p>
    </main>
  );
}
