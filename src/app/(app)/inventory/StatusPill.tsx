import type { StockStatus } from '@/lib/stock-ledger';

/**
 * Stock level as a shape, not only a number.
 *
 * Follows the palette rule set out in globals.css: NORMAL IS UNCOLOURED. A store
 * with nothing wrong shows a page with no colour on it, so the two states that
 * need acting on are the only two that carry any. "In stock" is deliberately
 * quiet — if healthy stock were green, the eye would stop distinguishing it from
 * the brand furniture, and the two rows that matter would stop standing out.
 *
 * The state is also encoded in the word, never in colour alone.
 */
const STYLES: Record<StockStatus, { label: string; className: string }> = {
  OUT: {
    label: 'Out of stock',
    className: 'border-status-critical bg-status-critical-bg text-status-critical',
  },
  CRITICAL: {
    label: 'Critically low',
    className: 'border-status-critical bg-status-critical-bg text-status-critical',
  },
  LOW: {
    label: 'Reorder',
    className: 'border-status-attention bg-status-attention-bg text-status-attention',
  },
  OK: {
    label: 'In stock',
    className: 'border-border-default bg-surface-sunken text-text-secondary',
  },
  UNTRACKED: {
    label: 'No level set',
    className: 'border-dashed border-border-strong bg-transparent text-text-muted',
  },
};

export function StatusPill({ status }: { status: StockStatus }) {
  const style = STYLES[status];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] font-semibold ${style.className}`}
    >
      {style.label}
    </span>
  );
}
