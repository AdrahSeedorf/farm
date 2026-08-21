import Link from 'next/link';

/**
 * Shown when a signed-in person opens a page their role does not cover.
 *
 * It names the area, not the permission string, and it does not hint at what
 * the page would have contained. Telling a farm worker that the finance
 * dashboard exists and holds "GHS 4,820 outstanding" defeats the point of
 * withholding it.
 */
export function Forbidden({
  area = 'this area',
  roles = [],
}: {
  area?: string;
  roles?: string[];
}) {
  return (
    <main className="mx-auto max-w-lg px-5 py-16">
      <div className="rounded-card border border-border-default bg-surface-card p-7 text-center">
        <div
          aria-hidden
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-accent-soft text-xl text-brand-accent"
        >
          !
        </div>
        <h1 className="mt-4 text-xl font-bold text-text-primary">
          You don&apos;t have access to {area}
        </h1>
        <p className="mt-2 text-[15px] text-text-secondary">
          Your account is signed in, but your role doesn&apos;t include this part of the
          farm system. If you need it, ask the farm owner to update your access.
        </p>
        {roles.length > 0 ? (
          <p className="mt-4 text-[13px] text-text-muted">
            Signed in as: {roles.join(', ')}
          </p>
        ) : null}
        <Link
          href="/"
          className="mt-6 inline-flex min-h-touch items-center rounded-control bg-brand-primary px-5 text-[15px] font-semibold text-text-inverse hover:bg-brand-primary-hover"
        >
          Go back
        </Link>
      </div>
    </main>
  );
}
