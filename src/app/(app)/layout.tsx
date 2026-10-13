import { Logo } from '@/components/brand/Logo';
import { NavDrawer } from '@/components/app/NavDrawer';
import { NavList } from '@/components/app/NavList';
import { ReflexRow } from '@/components/app/ReflexRow';
import { requireViewer } from '@/lib/session';
import { navigationFor } from '@/lib/navigation-service';
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
 *
 * ── THE SHAPE, AND WHY IT CHANGED ──────────────────────────────────────────
 *
 * The navigation used to be a single row under the header. With twenty-six
 * destinations it overflowed, and because the strip scrolled horizontally with
 * no visible scrollbar, eleven screens — every money screen, every admin screen,
 * and Settings — were silently unreachable on a normal window.
 *
 * Now: a grouped sidebar from `lg` upward, and on anything narrower a drawer
 * plus the four reflex screens kept in view. The groups are built once on the
 * server and handed to both, so the phone can never be missing a destination the
 * desktop has.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { principal, name } = await requireViewer();
  const groups = await navigationFor(principal);

  return (
    /**
     * A FIXED SHELL ON A DESKTOP, AN ORDINARY SCROLLING PAGE ON A PHONE.
     *
     * From `lg` up the shell owns the viewport height and the sidebar and the
     * content scroll independently — which is the only way a sidebar can stay
     * put while a long report scrolls past it, and it needs no hard-coded header
     * height to line up.
     *
     * Below `lg` none of that applies: an inner scrolling container stops a
     * mobile browser from hiding its address bar, which costs about sixty pixels
     * of a phone screen permanently. In a poultry house that is a row of the
     * form. So the page scrolls normally and the header merely sticks.
     */
    <div className="min-h-dvh lg:flex lg:h-dvh lg:min-h-0 lg:flex-col">
      <header className="sticky top-0 z-30 bg-brand-primary lg:static lg:shrink-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <NavDrawer groups={groups} />
            <Logo tone="reversed" height={34} />
          </div>
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
        <ReflexRow groups={groups} />
      </header>

      <div className="lg:flex lg:min-h-0 lg:flex-1">
        {/*
          Its own scroll, because an owner's twenty-six destinations are taller
          than a laptop screen. That scroll is vertical and carries a scrollbar,
          which is the whole difference from what it replaced: somebody who
          cannot see the bottom of a list knows there is a bottom.
        */}
        <aside className="hidden border-r border-border-default bg-surface-card lg:block lg:w-60 lg:shrink-0 lg:overflow-y-auto">
          <nav aria-label="Main" className="px-2 py-5">
            <NavList groups={groups} />
          </nav>
        </aside>

        {/* `min-w-0` or a wide table inside pushes the sidebar off the screen. */}
        <div className="min-w-0 lg:flex-1 lg:overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
