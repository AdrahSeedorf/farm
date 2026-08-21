import type { ReactNode } from 'react';

export type KpiStatus = 'normal' | 'attention' | 'critical';

interface KpiTileProps {
  label: string;
  /** Pre-formatted. Render null as "—" rather than 0 — an unknown is not a zero. */
  value: ReactNode;
  detail?: ReactNode;
  status?: KpiStatus;
  /** Optional footnote explaining how the figure is derived. */
  formula?: string;
}

/**
 * A single figure on the owner's morning screen.
 *
 * The status rule from the design system: NORMAL IS UNCOLOURED. Colour is spent
 * only on exceptions, so a dashboard with no colour on it means a farm with
 * nothing wrong — which is information the owner can read in half a second from
 * across a room.
 */
export function KpiTile({ label, value, detail, status = 'normal', formula }: KpiTileProps) {
  const surface =
    status === 'critical'
      ? 'border-status-critical bg-status-critical-bg'
      : status === 'attention'
        ? 'border-status-attention bg-status-attention-bg'
        : 'border-border-default bg-surface-card';

  const detailTone =
    status === 'critical'
      ? 'text-status-critical font-semibold'
      : status === 'attention'
        ? 'text-status-attention font-semibold'
        : 'text-text-secondary';

  return (
    <div className={`rounded-card border p-4 ${surface}`}>
      <div className="text-[11.5px] font-semibold uppercase tracking-[0.09em] text-text-muted">
        {label}
      </div>
      <div className="tabular mt-1.5 text-3xl font-bold tracking-tight text-text-primary">
        {value}
      </div>
      {detail ? <div className={`mt-0.5 text-[12.5px] ${detailTone}`}>{detail}</div> : null}
      {formula ? (
        <div className="mt-2 border-t border-border-default pt-2 text-[11px] text-text-muted">
          {formula}
        </div>
      ) : null}
    </div>
  );
}

/** Render a possibly-null metric honestly. */
export function metric(
  value: number | null,
  options: { suffix?: string; decimals?: number } = {},
): string {
  const { suffix = '', decimals = 0 } = options;
  if (value === null || !Number.isFinite(value)) return '—';
  return (
    new Intl.NumberFormat('en-GH', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value) + suffix
  );
}
