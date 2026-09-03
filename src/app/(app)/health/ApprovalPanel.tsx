'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, FormError, Button } from '@/components/ui/form';
import { approveProgramme, revokeApproval, type HealthFormState } from './actions';

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

/**
 * Record that a named veterinarian reviewed this programme.
 *
 * The name is free text because most vets attending a Ghanaian farm will never
 * have an account here, and demanding one would mean the approval simply never
 * gets recorded — which is worse than recording who it was on trust.
 *
 * What the system does guarantee is that the name is tied to THIS version. Any
 * later change to the entries clears it, so an approval can never sit on a
 * schedule its approver never saw.
 */
export function ApprovalPanel({
  programmeId,
  status,
  approvedByName,
  today,
}: {
  programmeId: string;
  status: 'DRAFT' | 'APPROVED';
  approvedByName: string | null;
  today: string;
}) {
  const [approved, approveAction] = useActionState(
    approveProgramme.bind(null, programmeId),
    {} as HealthFormState,
  );
  const [revoked, revokeAction] = useActionState(
    revokeApproval.bind(null, programmeId),
    {} as HealthFormState,
  );

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [on, setOn] = useState(today);

  if (status === 'APPROVED') {
    return (
      <form action={revokeAction}>
        <input type="hidden" name="intent" value="revoke" />
        <FormError message={revoked.error} />
        <p className="text-[14px] text-text-secondary">
          Reviewed by <strong className="font-semibold text-text-primary">{approvedByName}</strong>.
          Withdraw this if the schedule needs looking at again.
        </p>
        <div className="mt-3">
          <Submit label="Withdraw approval" busy="Withdrawing…" />
        </div>
      </form>
    );
  }

  return (
    <form action={approveAction} className="space-y-4" noValidate>
      <FormError message={approved.error} />
      {approved.ok ? (
        <p
          role="status"
          className="rounded-control border border-border-strong bg-surface-sunken px-3 py-2.5 text-sm font-medium text-text-primary"
        >
          {approved.ok}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Reviewed by"
          htmlFor="approvedByName"
          required
          error={approved.fieldErrors?.approvedByName}
        >
          <TextInput
            id="approvedByName"
            name="approvedByName"
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            placeholder="Dr Mensah"
            error={approved.fieldErrors?.approvedByName}
            required
          />
        </Field>
        <Field label="Their role" htmlFor="approvedByRole" error={approved.fieldErrors?.approvedByRole}>
          <TextInput
            id="approvedByRole"
            name="approvedByRole"
            value={role}
            onChange={(ev) => setRole(ev.target.value)}
            placeholder="Veterinary Officer, Adansi South"
            error={approved.fieldErrors?.approvedByRole}
          />
        </Field>
      </div>

      <Field
        label="Reviewed on"
        htmlFor="approvedOn"
        required
        error={approved.fieldErrors?.approvedOn}
      >
        <TextInput
          id="approvedOn"
          name="approvedOn"
          type="date"
          max={today}
          value={on}
          onChange={(ev) => setOn(ev.target.value)}
          error={approved.fieldErrors?.approvedOn}
          required
        />
      </Field>

      <Submit label="Record the review" busy="Recording…" />
    </form>
  );
}
