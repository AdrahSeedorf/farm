import type { Permission } from '@/lib/rbac';
import type { Terminology } from '@/lib/terminology';
import { ALERT_RULES, RULE_CATALOGUE } from '@/lib/alerts';

/**
 * Navigation model — ADRAH Farms
 *
 * WHAT WENT WRONG, AND WHY THIS FILE EXISTS
 *
 * The navigation was one row of links in a horizontally scrolling strip. It was
 * written when there were six destinations and it was never revisited as the
 * application grew to twenty-six. On a 1000-pixel window an owner saw fifteen of
 * them; the other eleven — every money screen, every admin screen, and Settings
 * — were reachable only by swiping sideways in a strip with no visible
 * scrollbar. Which is to say they were not reachable at all, because nobody
 * swipes a bar that gives no sign there is anything past its edge. The farm's
 * owner concluded a feature had not been built when it had been built months
 * earlier.
 *
 * So the list is no longer a list. It is a structure, and it lives here rather
 * than in the component, for three reasons:
 *
 *   1. It can be tested. A browser test can assert that every destination a role
 *      holds is reachable, which is the property that silently stopped being
 *      true.
 *   2. Permissions are resolved ONCE per distinct permission rather than once
 *      per link. The old component asked `report:view` twice and `flock:view`
 *      twice on every single page render.
 *   3. Growth is visible. Adding a destination now means choosing which group it
 *      belongs to, and a group that has grown past about six entries is obvious
 *      in a way that a twenty-sixth entry on a row never was.
 *
 * NOTHING HERE IS A SECURITY CONTROL. A hidden link is a courtesy. Every
 * destination re-checks its own permission, and someone who types the URL gets
 * the same answer as someone who never saw the link.
 */

/** A word that depends on what this farm keeps. */
type Word = string | ((words: Terminology) => string);

export interface NavItemSpec {
  href: string;
  label: Word;
  /** A list means ANY of them is enough. */
  permission: Permission | Permission[];
}

export interface NavGroupSpec {
  /**
   * `null` means no heading: the handful of screens somebody opens without
   * thinking about where they live. They sit above the first heading.
   */
  heading: Word | null;
  items: NavItemSpec[];
}

export interface NavItem {
  href: string;
  label: string;
  permission: Permission | Permission[];
}

export interface NavGroup {
  heading: string | null;
  items: NavItem[];
}

/**
 * The produce, as this farm says it — "Eggs" here, "Milk" on a dairy.
 *
 * Resolved from the species profile rather than typed in, because a navigation
 * label is the most-read text in the application and hard-coding "Eggs" would
 * put a poultry word at the top of every screen on a farm that had moved on.
 */
const produce = (w: Terminology) => w.production;

/**
 * The animals, as this farm says them — "Birds", "Pigs", "Cows".
 *
 * A GROUP HEADING IS AS SPECIES-BOUND AS A FIELD LABEL, and it is the more
 * dangerous of the two because it sits above five screens rather than one. The
 * schema has never been allowed to say "flock"; the heading over Flocks, Health
 * and Lighting must not say "Birds" on a farm that keeps goats.
 */
const animals = (w: Terminology) => w.animalPlural;

/**
 * The structure.
 *
 * ORDER IS FREQUENCY, NOT ALPHABET OR IMPORTANCE. The first group is what a
 * person opens when they sit down; the last is what they open twice a year.
 */
export const NAV_SPEC: NavGroupSpec[] = [
  {
    // No heading. These four are opened without deciding to — a heading above
    // them would be a label on a reflex.
    heading: null,
    items: [
      { href: '/daily', label: 'Today', permission: 'dailyRecord:view' },
      /**
       * A LIST, AND IT HAS TO BE ONE. Every alert rule carries its own
       * permission, so the screen shows each reader the subset they hold rather
       * than being one owner-only page. A single permission here would have
       * hidden it from the worker whose overdue task and unread incident report
       * are sitting on it.
       */
      {
        href: '/alerts',
        label: 'Alerts',
        permission: ALERT_RULES.map((r) => RULE_CATALOGUE[r].permission),
      },
      { href: '/dashboard', label: 'Dashboard', permission: 'report:view' },
      { href: '/reports', label: 'Report', permission: 'report:view' },
    ],
  },
  {
    heading: animals,
    items: [
      { href: '/flocks', label: (w) => w.animalGroupPlural, permission: 'flock:view' },
      { href: '/production', label: produce, permission: 'production:view' },
      { href: '/health', label: 'Health', permission: 'health:view' },
      // Daylength is husbandry, not medicine. The person who needs the
      // switch-on time is walking into the house at five in the morning and
      // should not have to know which section somebody filed it under.
      { href: '/lighting', label: 'Lighting', permission: 'flock:view' },
      { href: '/biosecurity', label: 'Biosecurity', permission: 'biosecurity:view' },
    ],
  },
  {
    heading: 'Stock',
    items: [
      { href: '/inventory', label: 'Store', permission: 'inventory:view' },
      { href: '/purchases', label: 'Purchases', permission: 'procurement:view' },
      { href: '/suppliers', label: 'Suppliers', permission: 'supplier:view' },
    ],
  },
  {
    heading: 'Selling',
    items: [
      // First, because it is the one somebody opens with a customer standing in
      // front of them.
      { href: '/sell', label: 'Sell', permission: 'order:create' },
      { href: '/orders', label: 'Orders', permission: 'order:view' },
      { href: '/dispatch', label: 'Loads out', permission: 'delivery:view' },
      { href: '/customers', label: 'Buyers', permission: 'customer:view' },
      { href: '/enquiries', label: 'Enquiries', permission: 'customer:view' },
      { href: '/pricing', label: 'Prices', permission: 'product:view' },
    ],
  },
  {
    heading: 'Money',
    items: [
      { href: '/payments', label: 'Money in', permission: 'payment:view' },
      { href: '/costs', label: 'Costs', permission: 'finance:view' },
    ],
  },
  {
    heading: 'Jobs',
    items: [
      { href: '/tasks', label: 'Tasks', permission: 'task:view' },
      { href: '/incidents', label: 'Incidents', permission: 'incident:view' },
    ],
  },
  {
    heading: 'Team',
    items: [
      { href: '/attendance', label: 'Attendance', permission: 'attendance:view' },
      { href: '/staff', label: 'People', permission: 'user:view' },
    ],
  },
  {
    heading: 'Setup',
    items: [
      { href: '/sites', label: 'Farms', permission: 'site:view' },
      { href: '/settings', label: 'Settings', permission: 'settings:view' },
    ],
  },
];

/** Every distinct permission the navigation needs, so each is asked for once. */
export function permissionsNeeded(spec: NavGroupSpec[] = NAV_SPEC): Permission[] {
  const seen = new Set<Permission>();
  for (const group of spec) {
    for (const item of group.items) {
      const wanted = Array.isArray(item.permission) ? item.permission : [item.permission];
      for (const p of wanted) seen.add(p);
    }
  }
  return [...seen];
}

const read = (word: Word, words: Terminology): string =>
  typeof word === 'function' ? word(words) : word;

/**
 * Build what this person may see.
 *
 * PURE AND SYNCHRONOUS. The caller resolves permissions however it likes and
 * hands the answers in, which is what makes the shape of the navigation testable
 * without a database, a session or a browser.
 *
 * A group with nothing left in it disappears entirely — heading and all. A
 * heading over no links is a promise of a screen that is not there.
 */
export function buildNav(
  words: Terminology,
  granted: ReadonlySet<Permission>,
  spec: NavGroupSpec[] = NAV_SPEC,
): NavGroup[] {
  const out: NavGroup[] = [];

  for (const group of spec) {
    const items: NavItem[] = [];
    for (const item of group.items) {
      const wanted = Array.isArray(item.permission) ? item.permission : [item.permission];
      /**
       * AN EMPTY LIST MEANS NOBODY, NOT EVERYBODY.
       *
       * Nothing in the spec ships empty today. The guard is here because the
       * alternative default — treating "no permission required" as "show it to
       * everyone" — turns a future typo into a link that every worker can see.
       * A missing link gets reported; a link that should not be there does not.
       */
      if (wanted.length === 0) continue;
      if (!wanted.some((p) => granted.has(p))) continue;
      items.push({ href: item.href, label: read(item.label, words), permission: item.permission });
    }
    if (items.length > 0) out.push({ heading: group.heading ? read(group.heading, words) : null, items });
  }

  return out;
}

/**
 * Which group a path belongs to, for marking the current place.
 *
 * Longest match wins, so `/flocks/abc/weights` finds `/flocks` rather than
 * matching nothing, and a future `/settings/breeds` does not light up `/sites`.
 */
export function currentHref(pathname: string, groups: NavGroup[]): string | null {
  let best: string | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      const hit = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (hit && (best === null || item.href.length > best.length)) best = item.href;
    }
  }
  return best;
}
