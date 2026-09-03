import type { ActiveWithdrawal } from '@/lib/health-schedule';

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * What this flock's produce may not be sold as, and until when.
 *
 * Always in critical colour, never softened. A withdrawal period is the one
 * thing in this system where getting it wrong puts something in a customer's
 * food, and it is worth being the loudest message on the page.
 */
export function WithdrawalBanner({
  withdrawals,
  eggsClearOn,
  meatClearsOn,
  className = '',
}: {
  withdrawals: ActiveWithdrawal[];
  eggsClearOn: Date | null;
  meatClearsOn: Date | null;
  className?: string;
}) {
  if (withdrawals.length === 0) return null;

  return (
    <div
      role="alert"
      className={`rounded-card border border-status-critical bg-status-critical-bg px-4 py-3.5 ${className}`}
    >
      <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-status-critical">
        Withdrawal period in force
      </p>

      <ul className="mt-1.5 space-y-1 text-[15px] font-medium text-status-critical">
        {eggsClearOn ? (
          <li>Eggs must not be sold until {day(eggsClearOn)}.</li>
        ) : null}
        {meatClearsOn ? (
          <li>Birds must not be sold for meat until {day(meatClearsOn)}.</li>
        ) : null}
      </ul>

      <ul className="mt-2 space-y-0.5 text-[13px] text-status-critical">
        {withdrawals.map((w) => (
          <li key={`${w.name}-${w.kind}-${w.clearsOn.toISOString()}`}>
            {w.name}, given {day(w.treatedOn)} — {w.kind === 'EGGS' ? 'eggs' : 'meat'} clear{' '}
            {day(w.clearsOn)} ({w.daysRemaining} day{w.daysRemaining === 1 ? '' : 's'} to go)
          </li>
        ))}
      </ul>
    </div>
  );
}
