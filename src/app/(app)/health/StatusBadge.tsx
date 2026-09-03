/**
 * Whether a programme has been signed off.
 *
 * Draft is marked in colour and approved is not — the same rule the rest of the
 * system follows, that normal is uncoloured and colour marks the exception. Here
 * the exception is a schedule nobody qualified has looked at, which is exactly
 * the thing that should catch the eye.
 */
export function StatusBadge({ status }: { status: 'DRAFT' | 'APPROVED' }) {
  const draft = status === 'DRAFT';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] font-semibold ${
        draft
          ? 'border-status-attention bg-status-attention-bg text-status-attention'
          : 'border-border-default bg-surface-sunken text-text-secondary'
      }`}
    >
      {draft ? 'Not vet-reviewed' : 'Vet-reviewed'}
    </span>
  );
}
