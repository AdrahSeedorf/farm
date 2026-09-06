import type { Metadata } from 'next';
import { pageGuard, currentUserCan } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import {
  shiftsBetween,
  openShiftFor,
  clockSites,
  correctableStaff,
} from '@/lib/attendance-service';
import {
  shiftSentence,
  shiftWarnings,
  totalHours,
  openFor,
  clock,
} from '@/lib/attendance';
import { PunchForm, CorrectionForm } from './ClockForms';

export const metadata: Metadata = { title: 'Attendance' };

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Who is on the farm, and who was.
 *
 * THE PERSON'S OWN BUTTON COMES FIRST, above everything else. Most of the people
 * opening this screen are opening it to press one button, and making them scroll
 * past a week of other people's hours to reach it is how a farm ends up with an
 * attendance record nobody keeps.
 */
export default async function AttendancePage() {
  const { principal, allowed } = await pageGuard('attendance:view');
  if (!allowed) return <Forbidden area="attendance" roles={principal.roles} />;

  const now = new Date();
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const weekStart = new Date(todayStart.getTime() - 6 * 86_400_000);

  const [mine, sites, weekShifts, canCorrect] = await Promise.all([
    openShiftFor(principal, principal.userId),
    clockSites(principal),
    shiftsBetween(principal, weekStart, now),
    currentUserCan('attendance:edit'),
  ]);

  const staff = canCorrect ? await correctableStaff(principal) : [];

  const onFarmNow = weekShifts.filter((s) => s.state === 'OPEN');
  const today = weekShifts.filter(
    (s) => (s.startedAt ?? s.endedAt!) >= todayStart,
  );
  const week = totalHours(weekShifts);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="text-2xl font-bold text-text-primary">Attendance</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        Who is on the farm, and who was. Hours worked, not hours paid.
      </p>

      {/* The button, first. */}
      <section className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <PunchForm
          sites={sites}
          openSiteId={mine?.siteId ?? null}
          isClockedIn={mine !== null}
          sinceLabel={mine?.startedAt ? clock(mine.startedAt) : null}
        />
      </section>

      {onFarmNow.length > 0 ? (
        <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
          <h2 className="text-lg font-semibold text-text-primary">On the farm now</h2>
          <ul className="mt-3 space-y-2">
            {onFarmNow.map((shift) => {
              const warnings = shiftWarnings(shift, now);
              return (
                <li key={`${shift.userId}-${shift.id}`} className="text-[15px]">
                  <span className="font-semibold text-text-primary">{shift.userName}</span>{' '}
                  <span className="tabular text-text-secondary">
                    since {clock(shift.startedAt!)} — {openFor(shift, now)} hours
                  </span>
                  {warnings.map((w) => (
                    <span
                      key={w}
                      className="mt-0.5 block text-[13px] font-medium text-status-attention"
                    >
                      {w}
                    </span>
                  ))}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="mt-6 rounded-control border border-border-default bg-surface-card px-4 py-3 text-[14px] text-text-secondary">
          Nobody is clocked in at the moment.
        </p>
      )}

      <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
        <h2 className="text-lg font-semibold text-text-primary">Today</h2>
        {today.length === 0 ? (
          <p className="mt-2 text-[15px] text-text-secondary">
            Nothing recorded today yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border-default">
            {today.map((shift) => (
              <li key={`${shift.userId}-${shift.id ?? shift.endedAt!.toISOString()}`} className="py-2.5">
                <p className="text-[15px] font-semibold text-text-primary">
                  {shift.userName}
                </p>
                <p className="tabular text-[14px] text-text-secondary">
                  {shiftSentence(shift, now)}
                </p>
                {shift.hasCorrection ? (
                  <p className="text-[13px] text-text-muted">
                    Part of this was recorded by somebody else.
                  </p>
                ) : null}
                {shiftWarnings(shift, now).map((w) => (
                  <p key={w} className="text-[13px] font-medium text-status-attention">
                    {w}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
        <h2 className="text-lg font-semibold text-text-primary">
          The last seven days
        </h2>
        <p className="tabular mt-2 text-[17px] font-bold text-text-primary">
          {week.hours} hours
        </p>
        {/* NEVER PRESENTED AS COMPLETE when it is not. An open shift counted as
            zero understates the week; counted up to now it inflates it. */}
        {week.unfinished > 0 ? (
          <p className="mt-1 text-[13px] text-text-muted">
            {week.unfinished} shift{week.unfinished === 1 ? '' : 's'} not finished, so this
            total is not the whole week.
          </p>
        ) : null}
        <p className="mt-3 text-[13px] text-text-secondary">
          From {day(weekStart)} to {day(todayStart)}. Elapsed time only — this is not a
          payroll figure and nothing here calculates one.
        </p>
      </section>

      {canCorrect ? (
        <section className="mt-6 rounded-card border border-border-default bg-surface-card p-6">
          <h2 className="text-[15px] font-semibold text-text-primary">
            Somebody forgot to clock out?
          </h2>
          <p className="mt-1 max-w-lg text-[14px] text-text-secondary">
            Nothing closes an open shift automatically. A record that tidies itself
            overnight is a record that quietly makes times up, so this is the only way —
            and it keeps your name and your reason on it.
          </p>
          <div className="mt-4">
            <CorrectionForm staff={staff} sites={sites} today={day(now)} />
          </div>
        </section>
      ) : null}
    </main>
  );
}
