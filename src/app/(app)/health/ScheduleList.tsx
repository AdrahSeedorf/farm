import Link from 'next/link';
import { scheduleSentence, type ScheduledEntry } from '@/lib/health-schedule';

const STYLES: Record<string, string> = {
  OVERDUE: 'border-status-critical bg-status-critical-bg text-status-critical',
  DUE: 'border-status-attention bg-status-attention-bg text-status-attention',
  UPCOMING: 'border-border-default bg-surface-sunken text-text-secondary',
  DONE: 'border-border-default bg-transparent text-text-muted',
  NOT_APPLICABLE: 'border-dashed border-border-strong bg-transparent text-text-muted',
};

const LABELS: Record<string, string> = {
  OVERDUE: 'Overdue',
  DUE: 'Due',
  UPCOMING: 'Upcoming',
  DONE: 'Given',
  NOT_APPLICABLE: 'Not applicable',
};

export function StatusChip({ status }: { status: ScheduledEntry['status'] }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] font-semibold ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}

/**
 * One flock's schedule.
 *
 * Overdue and due carry colour; everything else does not. A schedule where the
 * whole list is coloured is a schedule nobody reads, and the entries that matter
 * are the two or three that need doing this week.
 */
export function ScheduleList({
  schedule,
  recordHref,
  canRecord,
}: {
  schedule: ScheduledEntry[];
  recordHref?: (entry: ScheduledEntry) => string;
  canRecord?: boolean;
}) {
  if (schedule.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-border-strong bg-surface-card p-6 text-[15px] text-text-secondary">
        Nothing scheduled — this programme has no entries yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border-default overflow-hidden rounded-card border border-border-default bg-surface-card">
      {schedule.map((entry) => (
        <li
          key={entry.item.id}
          className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 ${
            entry.status === 'DONE' ? 'opacity-70' : ''
          }`}
        >
          <span className="tabular w-12 text-[13px] font-semibold text-text-muted">
            Day {entry.item.ageDays}
          </span>
          <span className="min-w-[8rem] flex-1 text-[15px] font-semibold text-text-primary">
            {entry.item.name}
          </span>
          <StatusChip status={entry.status} />
          <span className="w-full text-[13px] text-text-secondary sm:w-auto">
            {scheduleSentence(entry)}
          </span>
          {canRecord && recordHref && entry.status !== 'DONE' && entry.status !== 'NOT_APPLICABLE' ? (
            <Link
              href={recordHref(entry)}
              className="ml-auto min-h-[36px] rounded-control px-2.5 py-1.5 text-[13px] font-semibold text-brand-primary hover:bg-brand-primary-soft"
            >
              Record it
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
