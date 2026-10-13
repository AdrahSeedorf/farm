'use client';

import { useEffect, useRef, useState } from 'react';
import type { NavGroup } from '@/lib/navigation';
import { NavList } from './NavList';

/**
 * The navigation on a phone.
 *
 * WHY A DRAWER AND NOT THE OLD ROW
 *   The row worked until the application had twenty-six destinations, at which
 *   point eleven of them sat past the right edge of the screen in a strip with
 *   no scrollbar. A drawer holds all of them, grouped, in a list that scrolls
 *   the way every list scrolls.
 *
 * WHY THE FOUR REFLEX SCREENS STAY OUT OF IT
 *   Today, Alerts, Dashboard and Report are opened without deciding to. Putting
 *   them behind a tap would cost the person in the poultry house a tap on every
 *   single visit, to fix a problem they never had — their list was never too
 *   long. They stay visible; see `ReflexRow` in the layout.
 *
 * A <dialog> RATHER THAN A HAND-ROLLED PANEL. Focus goes into it and cannot
 * leave, Escape closes it, and the rest of the page goes inert — all of it from
 * the browser, none of it from code that has to be right.
 */
export function NavDrawer({ groups }: { groups: NavGroup[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Escape and the browser's own dismissal do not go through setOpen, so the
  // button's `aria-expanded` would otherwise keep claiming the drawer is open.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const sync = () => setOpen(false);
    dialog.addEventListener('close', sync);
    return () => dialog.removeEventListener('close', sync);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="nav-drawer"
        className="flex min-h-touch min-w-touch items-center justify-center rounded-control border border-brand-accent-on-dark/40 px-3 text-brand-accent-on-dark transition-colors hover:bg-white/10 lg:hidden"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden focusable="false">
          <path
            d="M3 5h14M3 10h14M3 15h14"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <span className="sr-only">Menu</span>
      </button>

      <dialog
        id="nav-drawer"
        ref={ref}
        aria-label="Main"
        onClick={(event) => {
          // The dialog element fills the viewport; the panel inside does not.
          // A click that lands on the dialog itself landed on the backdrop.
          if (event.target === ref.current) setOpen(false);
        }}
        className="m-0 h-dvh max-h-dvh w-[18rem] max-w-[85vw] bg-transparent p-0 backdrop:bg-black/40"
      >
        <div className="flex h-full flex-col bg-surface-card">
          <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
            <span className="text-[13px] font-semibold uppercase tracking-[0.12em] text-text-muted">
              Go to
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex min-h-touch min-w-touch items-center justify-center rounded-control text-text-secondary transition-colors hover:bg-surface-sunken"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden focusable="false">
                <path
                  d="M5 5l10 10M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              <span className="sr-only">Close</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-4">
            <NavList groups={groups} density="comfortable" onNavigate={() => setOpen(false)} />
          </div>
        </div>
      </dialog>
    </>
  );
}
