import Link from 'next/link';
import { db } from '@/lib/db';
import { currentUserCan, requirePrincipal } from '@/lib/session';
import { terminologyFrom } from '@/lib/terminology';
import type { Permission } from '@/lib/rbac';
import { ALERT_RULES, RULE_CATALOGUE } from '@/lib/alerts';

/**
 * Primary navigation.
 *
 * Links are hidden when the permission is absent — but that is a COURTESY, not a
 * control. Every destination re-checks for itself. Someone who types the URL
 * gets the same answer as someone who never saw the link.
 */
/**
 * `permission` may be a list, meaning ANY of them is enough.
 *
 * Only Alerts uses it, and it needs it: every alert rule carries its own
 * permission, so the page shows each reader the subset they hold rather than
 * being one owner-only screen. A single permission on the link would have hidden
 * it from the worker whose overdue task and unread incident report are on it.
 */
const ITEMS: { href: string; label: string; permission: Permission | Permission[] }[] = [
  { href: '/daily', label: 'Today', permission: 'dailyRecord:view' },
  {
    href: '/alerts',
    label: 'Alerts',
    permission: ALERT_RULES.map((r) => RULE_CATALOGUE[r].permission),
  },
  { href: '/dashboard', label: 'Dashboard', permission: 'report:view' },
  { href: '/flocks', label: 'Flocks', permission: 'flock:view' },
  // Labelled from the species profile below, not from this string. See productionLabel().
  { href: '/production', label: 'Production', permission: 'production:view' },
  { href: '/health', label: 'Health', permission: 'health:view' },
  { href: '/biosecurity', label: 'Biosecurity', permission: 'biosecurity:view' },
  { href: '/inventory', label: 'Store', permission: 'inventory:view' },
  { href: '/purchases', label: 'Purchases', permission: 'procurement:view' },
  { href: '/suppliers', label: 'Suppliers', permission: 'supplier:view' },
  { href: '/pricing', label: 'Prices', permission: 'product:view' },
  { href: '/customers', label: 'Buyers', permission: 'customer:view' },
  { href: '/enquiries', label: 'Enquiries', permission: 'customer:view' },
  { href: '/costs', label: 'Costs', permission: 'finance:view' },
  { href: '/sites', label: 'Farms', permission: 'site:view' },
  { href: '/tasks', label: 'Tasks', permission: 'task:view' },
  { href: '/incidents', label: 'Incidents', permission: 'incident:view' },
  { href: '/attendance', label: 'Attendance', permission: 'attendance:view' },
  { href: '/staff', label: 'People', permission: 'user:view' },
  { href: '/settings', label: 'Settings', permission: 'settings:view' },
];

/**
 * What this farm calls its produce — "Eggs" here, "Milk" on a dairy.
 *
 * Resolved from the species profile rather than typed into the list above,
 * because a navigation label is the most-read text in the whole application and
 * hard-coding "Eggs" there would put a poultry word at the top of every screen.
 *
 * A farm running more than one species gets the neutral word: with two profiles
 * there is no single right answer, and "Production" is honest where "Eggs" would
 * be wrong half the time.
 */
async function productionLabel(organisationId: string): Promise<string> {
  const profiles = await db.speciesProfile.findMany({
    where: { organisationId, isActive: true },
    select: { terminology: true },
    take: 2,
  });
  if (profiles.length !== 1) return 'Production';
  return terminologyFrom(profiles[0].terminology).production;
}

export async function Nav() {
  const principal = await requirePrincipal();

  const visible = await Promise.all(
    ITEMS.map(async (item) => {
      const wanted = Array.isArray(item.permission) ? item.permission : [item.permission];
      const answers = await Promise.all(wanted.map((p) => currentUserCan(p)));
      return answers.some(Boolean) ? item : null;
    }),
  );
  const produce = await productionLabel(principal.organisationId);
  const items = visible
    .filter((i): i is (typeof ITEMS)[number] => i !== null)
    .map((item) => (item.href === '/production' ? { ...item, label: produce } : item));

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
