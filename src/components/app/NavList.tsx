'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { currentHref, type NavGroup } from '@/lib/navigation';

/**
 * The grouped list of destinations.
 *
 * Shared by the sidebar on a desktop and the drawer on a phone, so the two can
 * never drift apart — which is the usual way a mobile menu ends up missing the
 * screen somebody needs.
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
   * twenty-six destinations over a thousand pixels tall.
   */
  density?: 'compact' | 'comfortable';
  /** Called when a link is followed, so the drawer can close itself. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const here = currentHref(pathname, groups);
  const rowHeight = density === 'comfortable' ? 'min-h-touch py-3' : 'py-2';

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group, index) => (
        <div key={group.heading ?? `top-${index}`}>
          {group.heading ? (
            <h2 className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
              {group.heading}
            </h2>
          ) : null}
          <ul>
            {group.items.map((item) => {
              const active = item.href === here;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    /**
                     * `aria-current` rather than colour alone. The green
                     * background below says "you are here" to somebody who can
                     * see it; this says the same thing to somebody who cannot,
                     * and to anybody whose screen washes the green out in
                     * sunlight — which is most of this farm, most of the day.
                     */
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center rounded-control px-3 text-[15px] transition-colors ${rowHeight} ${
                      active
                        ? 'bg-brand-primary-soft font-semibold text-brand-primary'
                        : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
