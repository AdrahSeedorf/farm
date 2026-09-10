'use server';

import { headers } from 'next/headers';
import { enquirySchema, looksAutomated } from '@/lib/validation/enquiry';
import { recordEnquiry, EnquiryError } from '@/lib/enquiry-service';
import { fieldErrorsFrom } from '@/lib/validation/site';

export interface EnquiryFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: string;
}

/**
 * The public enquiry form's action.
 *
 * THE ONLY SERVER ACTION IN THIS CODEBASE THAT DOES NOT CALL `requirePermission`,
 * and the only one that should ever be. It is written so that being public
 * cannot matter:
 *
 *   - it takes no ids from the form that address anything (no flock, no site, no
 *     price), so there is nothing to tamper with;
 *   - it writes one row to one table that affects no ledger;
 *   - it never reads anything back to the caller beyond a thank-you.
 *
 * A public action that took an id would be an authorisation problem wearing a
 * form. This one has no surface to have one.
 */
export async function submitEnquiry(
  _prev: EnquiryFormState,
  formData: FormData,
): Promise<EnquiryFormState> {
  const parsed = enquirySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  // THE HONEYPOT IS ANSWERED WITH SUCCESS, NOT AN ERROR. Telling an automated
  // submitter that it was caught is telling it how to try again; a thank-you
  // that writes nothing costs it a request and teaches it nothing. A real person
  // can never reach this branch — the field is not on their screen.
  if (looksAutomated(parsed.data)) {
    return { ok: 'Thank you — we will come back to you.' };
  }

  // The honeypot is dropped rather than stored — it is never evidence of
  // anything worth keeping, and a column of empty strings is a column somebody
  // will one day wonder about.
  const input = { ...parsed.data, website: undefined };
  delete (input as { website?: string }).website;

  // Behind a proxy the socket address is the proxy's. The forwarded header is
  // not trustworthy — anyone can send one — which is fine here, because this
  // only feeds a courtesy rate limit on a form that cannot damage anything. It
  // is never used for authorisation, and never shown on any screen.
  const forwarded = (await headers()).get('x-forwarded-for');
  const ipAddress = forwarded?.split(',')[0]?.trim() ?? null;

  try {
    await recordEnquiry(input, ipAddress);
  } catch (error) {
    if (error instanceof EnquiryError) return { error: error.message };
    // A real failure must not be reported to a customer as their mistake.
    console.error('Enquiry failed', error);
    return {
      error:
        'Something went wrong at our end, not yours. Please try again, or ring us if it keeps happening.',
    };
  }

  return {
    ok: 'Thank you — we have your enquiry and somebody will come back to you.',
  };
}
