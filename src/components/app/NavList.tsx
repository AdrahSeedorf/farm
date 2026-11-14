'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { currentHref, type NavGroup } from '@/lib/navigation';
import { NavIcon } from './NavIcon';

/**
 * The grouped list of destinations.
 *
 * Shared by the sidebar on a desktop and the drawer on a phone, so the two can
 * never drift apart — which is the usual way a mobile menu ends up missing the
 * screen somebody needs.
 *
 * ── WHY THE GROUPS COLLAPSE ────────────────────────────────────────────────
 *
 * An owner holds every permission, so an owner saw all of it at once: a column
 * of rows taller than the screen it was drawn on, every row the same size and
 * weight as every other. Grouping the links fixed the finding problem and left
 * the reading problem — twenty-four things with equal claim on the eye is not a
 * list anybody reads, it is a wall they scan past.
 *
 * So one group is open: the one holding the page you are on. The rest are a
 * heading each. The whole thing fits on a laptop screen without scrolling, and
 * the section you are working in is the section you can see.
 *
 * ── AND WHY THAT IS NOT THE OLD SIN AGAIN ──────────────────────────────────
 *
 * The navigation this replaced hid eleven screens behind the right-hand edge of
 * a strip with no scrollbar — nothing on the screen said they were there. A
 * closed group says its own name, carries a chevron, and opens on a tap. The
 * difference between a closed drawer and a missing one is whether it is
 * labelled.
 *
 * NOTHING HERE IS A SECURITY CONTROL. The groups arrive already filtered by the
 * server; every destination re-checks for itself when it loads.
 */
export function NavList({
  groups,
  density = 'compact',
  onNavigate,
}: {
  groups: NavGroup[];
  /**
   * `comfortable` gives every row the 48px touch target the farm's phones need.
   * `compact` is for a desktop pointer, where 48px rows would make an owner's
   * list taller than the screen again.
   */
  density?: 'compact' | 'comfortable';
  /** Called when a link is followed, so the drawer can close itself. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const here = currentHref(pathname, groups);
  const rowHeight = density === 'comfortable' ? 'min-h-touch py-3' : 'py-2';

  const currentGroup =
    groups.find((g) => g.heading && g.items.some((i) => i.href === here))?.heading ?? null;

  /**
   * OPENING FOLLOWS WHERE YOU ARE, and a deliberate toggle wins until you move.
   *
   * Derived during render rather than in an effect: an effect would paint the
   * old section open for one frame on every navigation. This is the same
   * reset-on-change pattern the receiving form uses, and React sanctions it.
   */
  const [opened, setOpened] = useState<{ group: string | null; toggled: Record<string, boolean> }>({
    group: currentGroup,
    toggled: {},
  });
  if (opened.group !== currentGroup) setOpened({ group: currentGroup, toggled: {} });

  const isOpen = (heading: string) => opened.toggled[heading] ?? heading === currentGroup;
  const toggle = (heading: string) =>
    setOpened((prev) => ({
      group: prev.group,
      toggled: { ...prev.toggled, [heading]: !(prev.toggled[heading] ?? heading === currentGroup) },
    }));

  const row = (item: NavGroup['items'][number]) => {
    const active = item.href === here;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          onClick={onNavigate}
          /**
           * `aria-current` rather than colour alone. The green background says
           * "you are here" to somebody who can see it; this says the same thing
           * to somebody who cannot, and to anybody whose screen is washed out by
           * sunlight — which is most of this farm, most of the day.
           */
          aria-current={active ? 'page' : undefined}
          className={`flex items-center gap-2.5 rounded-control px-3 text-[15px] transition-colors ${rowHeight} ${
            active
              ? 'bg-brand-primary-soft font-semibold text-brand-primary'
              : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary'
          }`}
        >
          <NavIcon name={item.icon} className="shrink-0 opacity-80" />
          <span className="truncate">{item.label}</span>
        </Link>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-1">
      {groups.map((group, index) => {
        // An unheaded group is always open: the handful of screens somebody
        // opens without deciding to, and Settings at the foot of the list.
        if (!group.heading) {
          return (
            <ul key={`open-${index}`} className="mb-1">
              {group.items.map(row)}
            </ul>
          );
        }

        const open = isOpen(group.heading);
        const panelId = `nav-${group.heading.toLowerCase().replace(/\s+/g, '-')}`;

        return (
          <div key={group.heading}>
            <button
              type="button"
              onClick={() => toggle(group.heading!)}
              aria-expanded={open}
              aria-controls={panelId}
              /**
               * HEAVIER THAN THE LINKS BENEATH IT, not lighter.
               *
               * The heading used to be the quietest thing in the column —
               * small, muted, uppercase — so the structure it was describing
               * was invisible and the list read as one undifferentiated run.
               * A heading that organises something has to out-weigh the things
               * it organises.
               */
              className="flex w-full items-center justify-between rounded-control px-3 py-2 text-left text-[12px] font-bold uppercase tracking-[0.08em] text-text-primary transition-colors hover:bg-surface-sunken"
            >
              {group.heading}
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                focusable="false"
                className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-90' : ''}`}
              >
                <path d="M4 2.5l4 3.5-4 3.5" />
              </svg>
            </button>
            {open ? (
              <ul id={panelId} className="mb-1">
                {group.items.map(row)}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
