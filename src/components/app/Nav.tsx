import Link from 'next/link';
import { currentUserCan } from '@/lib/session';
import type { Permission } from '@/lib/rbac';

/**
 * Primary navigation.
 *
 * Links are hidden when the permission is absent — but that is a COURTESY, not a
 * control. Every destination re-checks for itself. Someone who types the URL
 * gets the same answer as someone who never saw the link.
 */
const ITEMS: { href: string; label: string; permission: Permission }[] = [
  { href: '/daily', label: 'Today', permission: 'dailyRecord:view' },
  { href: '/dashboard', label: 'Dashboard', permission: 'report:view' },
  { href: '/flocks', label: 'Flocks', permission: 'flock:view' },
  { href: '/health', label: 'Health', permission: 'health:view' },
  { href: '/inventory', label: 'Store', permission: 'inventory:view' },
  { href: '/costs', label: 'Costs', permission: 'finance:view' },
  { href: '/sites', label: 'Farms', permission: 'site:view' },
  { href: '/settings', label: 'Settings', permission: 'settings:view' },
];

export async function Nav() {
  const visible = await Promise.all(
    ITEMS.map(async (item) => ((await currentUserCan(item.permission)) ? item : null)),
  );
  const items = visible.filter((i): i is (typeof ITEMS)[number] => i !== null);

  if (items.length === 0) return null;

  return (
    <nav aria-label="Main" className="border-t border-white/10 bg-brand-primary">
      <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="whitespace-nowrap px-3 py-2.5 text-[14px] font-semibold text-brand-accent-on-dark transition-colors hover:text-text-inverse"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
