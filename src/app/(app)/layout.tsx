import { Logo } from '@/components/brand/Logo';
import { Nav } from '@/components/app/Nav';
import { requireViewer } from '@/lib/session';
import { logout } from '@/app/login/actions';

/**
 * Authenticated application shell.
 *
 * `requireViewer()` here is a convenience, NOT the security boundary — a layout
 * does not reliably protect the pages beneath it. Every page and action inside
 * still performs its own check.
 *
 * The viewer's name comes off the session token, so drawing this header costs no
 * database query at all. It used to cost one on every single page view.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { principal, name } = await requireViewer();

  return (
    <div className="min-h-dvh">
      <header className="bg-brand-primary">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
          <Logo tone="reversed" height={34} />
          <div className="flex items-center gap-4">
            <div className="hidden text-right sm:block">
              <div className="text-[13px] font-semibold text-text-inverse">{name}</div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-brand-accent-on-dark">
                {principal.roles.join(' · ') || 'no role'}
              </div>
            </div>
            <form action={logout}>
              <button
                type="submit"
                className="min-h-[40px] rounded-control border border-brand-accent-on-dark/40 px-3.5 text-[13px] font-semibold text-brand-accent-on-dark transition-colors hover:bg-white/10"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
        <Nav />
      </header>
      {children}
    </div>
  );
}
