'use client';

import { useEffect } from 'react';

/**
 * Safety net for the authenticated area.
 *
 * Pages should handle their own authorisation gracefully (see `pageGuard`), so
 * reaching this boundary means something genuinely unexpected happened. The
 * message stays deliberately vague: Next.js replaces error details with an
 * opaque digest in production precisely so internals are not leaked to the
 * browser, and we do not undo that.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Milestone 13 forwards this to the alerting pipeline.
    console.error('Unhandled error in farm application:', error.digest ?? error.message);
  }, [error]);

  return (
    <main className="mx-auto max-w-lg px-5 py-16">
      <div className="rounded-card border border-status-critical bg-status-critical-bg p-7 text-center">
        <h1 className="text-xl font-bold text-text-primary">Something went wrong</h1>
        <p className="mt-2 text-[15px] text-text-secondary">
          The page could not be loaded. Nothing you entered has been lost.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[12px] text-text-muted">
            Reference: {error.digest}
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-6 min-h-touch rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
