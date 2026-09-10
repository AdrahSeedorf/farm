'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { markRead, markAnswered, archiveEnquiry, EnquiryError } from '@/lib/enquiry-service';

export interface EnquiryActionState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: string;
}

/**
 * Opening one.
 *
 * `customer:view` is enough to read the list, but recording that you have read
 * it is a claim about a person, so it takes `customer:edit` — the same shape as
 * everywhere else here: seeing and asserting are different rights.
 */
export async function readEnquiry(
  enquiryId: string,
  // `useActionState` always passes the previous state; these two actions have no
  // form fields to read, so it is accepted and ignored rather than the signature
  // being bent to hide it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: EnquiryActionState,
): Promise<EnquiryActionState> {
  const principal = await requirePermission('customer:edit');
  try {
    const result = await markRead(principal, enquiryId);
    await recordAudit({
      principal,
      action: 'enquiry.read',
      entityType: 'Enquiry',
      entityId: enquiryId,
      after: { name: result.name },
    });
  } catch (error) {
    if (error instanceof EnquiryError) return { error: error.message };
    throw error;
  }
  revalidatePath('/enquiries');
  revalidatePath('/alerts');
  return {};
}

export async function answerEnquiry(
  enquiryId: string,
  _prev: EnquiryActionState,
  formData: FormData,
): Promise<EnquiryActionState> {
  const principal = await requirePermission('customer:edit');
  const note = String(formData.get('note') ?? '');

  let result: { name: string };
  try {
    result = await markAnswered(principal, enquiryId, note);
  } catch (error) {
    if (error instanceof EnquiryError) return { fieldErrors: { note: error.message } };
    throw error;
  }

  // THE NOTE IS IN THE AUDIT LOG AS WELL AS ON THE ROW. It carries the price
  // quoted, and a price somebody later edits should not be able to erase what
  // was originally said.
  await recordAudit({
    principal,
    action: 'enquiry.answer',
    entityType: 'Enquiry',
    entityId: enquiryId,
    after: { name: result.name, note: note.trim() },
  });

  revalidatePath('/enquiries');
  revalidatePath('/alerts');
  return {};
}

export async function putAsideEnquiry(
  enquiryId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: EnquiryActionState,
): Promise<EnquiryActionState> {
  const principal = await requirePermission('customer:edit');
  try {
    const result = await archiveEnquiry(principal, enquiryId);
    await recordAudit({
      principal,
      action: 'enquiry.archive',
      entityType: 'Enquiry',
      entityId: enquiryId,
      after: { name: result.name },
    });
  } catch (error) {
    if (error instanceof EnquiryError) return { error: error.message };
    throw error;
  }
  revalidatePath('/enquiries');
  revalidatePath('/alerts');
  return {};
}
