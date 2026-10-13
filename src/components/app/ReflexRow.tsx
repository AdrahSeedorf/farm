'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { currentHref, type NavGroup } from '@/lib/navigation';

/**
 * The handful of screens somebody opens without deciding to, kept one tap away
 * on a phone.
 *
 * THIS IS THE OLD ROW, DELIBERATELY, AND IT IS SAFE NOW BECAUSE IT IS SHORT.
 * What broke the old navigation was not that it was a row; it was that
 * twenty-six things were in it and eleven fell off the edge. Four cannot fall
 * off the edge of a phone. Everything else lives in the drawer, where a list
 * scrolls the way lists are known to scroll.
 *
 * It renders only the unheaded group. If that group is ever given a heading, or
 * grows, this row stops being short and the whole argument above stops holding —
 * so it takes the group as it is rather than slicing one out of the list.
 */
export function ReflexRow({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const group = groups.find((g) => g.heading === null);
  const here = currentHref(pathname, groups);

  if (!group || group.items.length === 0) return null;

  return (
    <nav aria-label="Frequent" className="border-t border-white/10 bg-brand-primary lg:hidden">
      <div className="flex px-2">
        {group.items.map((item) => {
          const active = item.href === here;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-touch flex-1 items-center justify-center whitespace-nowrap px-2 text-[14px] font-semibold transition-colors ${
                active
                  ? 'border-b-2 border-brand-accent-on-dark text-text-inverse'
                  : 'border-b-2 border-transparent text-brand-accent-on-dark'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
