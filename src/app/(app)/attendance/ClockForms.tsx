'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, Select, FormError, Button } from '@/components/ui/form';
import { punch, correct, type ClockFormState } from './actions';

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

function Result({ state }: { state: ClockFormState }) {
  return (
    <>
      <FormError message={state.error} />
      {state.ok ? (
        <p
          role="status"
          className="mt-3 rounded-control border border-border-strong bg-surface-sunken px-3.5 py-2.5 text-[14px] font-medium text-text-primary"
        >
          {state.ok}
        </p>
      ) : null}
    </>
  );
}

/**
 * The one button this screen exists for.
 *
 * ONE BUTTON, NOT TWO. Somebody arriving at half five with a phone in a cold
 * hand should not have to work out which of "Clock in" and "Clock out" applies —
 * the system already knows, and offering both is how the wrong one gets pressed.
 *
 * THE TIME IS NOT ASKED FOR. It is the moment the button is pressed, recorded by
 * the server. A field here would make "I was in at six" a thing anybody could
 * type, which is the opposite of what an attendance record is for.
 */
export function PunchForm({
  sites,
  openSiteId,
  isClockedIn,
  sinceLabel,
}: {
  sites: { id: string; name: string }[];
  /** The farm of the shift already open, so clocking out cannot pick another. */
  openSiteId: string | null;
  isClockedIn: boolean;
  sinceLabel: string | null;
}) {
  const [state, formAction] = useActionState(punch, {} as ClockFormState);
  const [siteId, setSiteId] = useState(openSiteId ?? sites[0]?.id ?? '');

  if (sites.length === 0) {
    return (
      <p className="text-[15px] text-text-secondary">
        There is no farm set up for you to clock in at yet.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Result state={state} />

      {isClockedIn ? (
        <p className="text-[15px] text-text-primary">
          You have been on the farm since <strong>{sinceLabel}</strong>.
        </p>
      ) : (
        <p className="text-[15px] text-text-secondary">You are not clocked in.</p>
      )}

      {/* Clocking OUT cannot change the farm — a shift belongs to where it
          started, and letting the second half name a different one would make
          "who was at which farm" unanswerable. */}
      {isClockedIn ? (
        <input type="hidden" name="siteId" value={openSiteId ?? siteId} />
      ) : (
        <Field label="Which farm are you at?" htmlFor="siteId" required>
          <Select
            id="siteId"
            name="siteId"
            value={siteId}
            onChange={(ev) => setSiteId(ev.target.value)}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <input type="hidden" name="intent" value={isClockedIn ? 'out' : 'in'} />
      <Submit
        label={isClockedIn ? 'Clock out' : 'Clock in'}
        busy={isClockedIn ? 'Clocking out…' : 'Clocking in…'}
      />
    </form>
  );
}

/**
 * Recording a shift on somebody else's behalf.
 *
 * Behind a disclosure, because it is the uncommon path and putting it beside the
 * ordinary button invites people to use it for themselves. The reason is
 * required by the server as well as by this form.
 */
export function CorrectionForm({
  staff,
  sites,
  today,
}: {
  staff: { id: string; name: string }[];
  sites: { id: string; name: string }[];
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(correct, {} as ClockFormState);

  // EVERY FIELD HERE IS CONTROLLED, and the Select primitive submits a hidden
  // input carrying the React value rather than relying on the <select>'s own.
  //
  // React 19 resets a form's DOM after a server action returns. An uncontrolled
  // dropdown snaps back to its first option and an uncontrolled date box goes
  // blank — so the FIRST submit here (which is usually the one missing a reason)
  // silently wiped the person, the farm and the time, and the second submit sent
  // an empty form. The same bug has now appeared five times in this codebase;
  // see ui/form.tsx Select for the full story.
  const [userId, setUserId] = useState(staff[0]?.id ?? '');
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [intent, setIntent] = useState<'in' | 'out'>('out');
  const [occurredAt, setOccurredAt] = useState('');
  const [reason, setReason] = useState('');

  const e = state.fieldErrors ?? {};

  if (!open && !state.ok) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-touch items-center rounded-control border border-border-strong bg-surface-card px-4 text-[14px] font-semibold text-text-primary hover:bg-surface-sunken"
      >
        Record a shift for somebody else
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Result state={state} />

      <Field label="Whose shift" htmlFor="userId" required error={e.userId}>
        <Select
          id="userId"
          name="userId"
          value={userId}
          onChange={(ev) => setUserId(ev.target.value)}
          error={e.userId}
        >
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Which farm" htmlFor="correctionSiteId" required error={e.siteId}>
          <Select
            id="correctionSiteId"
            name="siteId"
            value={siteId}
            onChange={(ev) => setSiteId(ev.target.value)}
            error={e.siteId}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="In or out" htmlFor="intent" required>
          <Select
            id="intent"
            name="intent"
            value={intent}
            onChange={(ev) => setIntent(ev.target.value as 'in' | 'out')}
          >
            <option value="out">Clocking out</option>
            <option value="in">Clocking in</option>
          </Select>
        </Field>
      </div>

      <Field
        label="When it actually happened"
        htmlFor="occurredAt"
        required
        error={e.occurredAt}
        hint="The real time, not now. This is the whole point of recording it by hand."
      >
        <TextInput
          id="occurredAt"
          name="occurredAt"
          type="datetime-local"
          max={`${today}T23:59`}
          value={occurredAt}
          onChange={(ev) => setOccurredAt(ev.target.value)}
          error={e.occurredAt}
        />
      </Field>

      <Field
        label="Why are you recording it for them?"
        htmlFor="correctionReason"
        required
        error={e.correctionReason}
        hint="In three months this is the only answer to “why does it say I left at six”."
      >
        <TextInput
          id="correctionReason"
          name="correctionReason"
          placeholder="Phone was flat, told me at the gate"
          value={reason}
          onChange={(ev) => setReason(ev.target.value)}
          error={e.correctionReason}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Submit label="Record it" busy="Recording…" />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex min-h-touch items-center rounded-control px-4 text-[14px] font-semibold text-text-secondary hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
