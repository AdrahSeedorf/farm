import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NAV_SPEC,
  buildNav,
  currentHref,
  permissionsNeeded,
  type NavGroupSpec,
} from '@/lib/navigation';
import { ROLE_PERMISSIONS, PERMISSIONS, type Permission, type Role } from '@/lib/rbac';
import { DEFAULT_TERMINOLOGY, terminologyFrom, type Terminology } from '@/lib/terminology';

const held = (...roles: Role[]): Set<Permission> =>
  new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []));

const POULTRY: Terminology = terminologyFrom({
  animal: 'Bird',
  animalGroup: 'Flock',
  productionUnit: 'House',
  production: 'Eggs',
});

const hrefsIn = (spec: NavGroupSpec[] = NAV_SPEC) => spec.flatMap((g) => g.items.map((i) => i.href));

describe('the structure itself', () => {
  it('never lists the same destination twice', () => {
    const hrefs = hrefsIn();
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('asks only for permissions that exist', () => {
    const real = new Set<string>(PERMISSIONS);
    for (const group of NAV_SPEC) {
      for (const item of group.items) {
        const wanted = Array.isArray(item.permission) ? item.permission : [item.permission];
        expect(wanted.length, `${item.href} asks for nothing`).toBeGreaterThan(0);
        for (const p of wanted) {
          expect(real.has(p), `${item.href} asks for "${p}", which is not a permission`).toBe(true);
        }
      }
    }
  });

  it('asks for each distinct permission once', () => {
    const needed = permissionsNeeded();
    expect(new Set(needed).size).toBe(needed.length);
    // report:view and flock:view each appear on two links. The old component
    // asked for both twice on every page render.
    expect(needed).toContain('report:view');
    expect(needed).toContain('flock:view');
  });

  /**
   * THE REGRESSION THIS WHOLE FILE EXISTS FOR.
   *
   * A screen with no way to reach it is a screen nobody will use. Eleven of them
   * were in that state for weeks — present, permitted, rendered, and off the
   * right-hand edge of a strip with no scrollbar. The owner reported the staff
   * screen as missing; it had been there since Milestone 11.
   *
   * So: every top-level screen under (app) must appear in the navigation, and a
   * deliberate omission must say why in writing.
   */
  it('reaches every screen that exists', () => {
    const root = join(process.cwd(), 'src/app/(app)');
    const routes = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('[') && !e.name.startsWith('('))
      .map((e) => e.name)
      .filter((name) => existsSync(join(root, name, 'page.tsx')));

    const reachable = new Set(hrefsIn().map((h) => h.slice(1)));

    const deliberate: Record<string, string> = {
      // Nothing yet. An entry here is a promise that somebody chose this.
    };

    const orphans = routes.filter((r) => !reachable.has(r) && !(r in deliberate));
    expect(orphans, `no way to reach: ${orphans.join(', ')}`).toEqual([]);
  });

  it('points every link at a screen that exists', () => {
    const root = join(process.cwd(), 'src/app/(app)');
    for (const href of hrefsIn()) {
      const dir = join(root, href.slice(1));
      expect(existsSync(join(dir, 'page.tsx')), `${href} has no page`).toBe(true);
    }
  });

  /**
   * A group that has grown past about six entries has stopped being a group and
   * become the old row again, one level down.
   */
  it('keeps every group short enough to scan', () => {
    for (const group of NAV_SPEC) {
      expect(group.items.length, `${String(group.heading)} has too many`).toBeLessThanOrEqual(6);
    }
  });
});

describe('what each person sees', () => {
  it('shows an owner every destination', () => {
    const groups = buildNav(POULTRY, held('owner'));
    const shown = groups.flatMap((g) => g.items.map((i) => i.href));
    expect(shown.sort()).toEqual(hrefsIn().sort());
  });

  /**
   * THE WORKER IS WHY THE GROUPS ARE WORTH HAVING AND WHY THEY MUST COLLAPSE.
   *
   * A worker holds nine permissions. If empty groups survived, they would be
   * reading "Money", "Selling" and "Setup" headings with nothing underneath —
   * five promises of screens they cannot open.
   */
  it('hides money and admin from a worker entirely', () => {
    const groups = buildNav(POULTRY, held('worker'));
    const headings = groups.map((g) => g.heading);
    expect(headings).not.toContain('Money');
    expect(headings).not.toContain('Selling');
    expect(headings).not.toContain('Setup');

    const shown = groups.flatMap((g) => g.items.map((i) => i.href));
    expect(shown).not.toContain('/costs');
    expect(shown).not.toContain('/payments');
    expect(shown).not.toContain('/staff');
    expect(shown).not.toContain('/settings');
  });

  it('leaves no heading standing over nothing', () => {
    for (const role of ['owner', 'manager', 'supervisor', 'worker', 'storekeeper'] as Role[]) {
      for (const group of buildNav(POULTRY, held(role))) {
        expect(group.items.length, `${role} sees an empty "${group.heading}"`).toBeGreaterThan(0);
      }
    }
  });

  it('gives somebody with nothing an empty navigation rather than headings', () => {
    expect(buildNav(POULTRY, new Set())).toEqual([]);
  });

  it('shows Alerts to a worker, who has overdue tasks on it', () => {
    const shown = buildNav(POULTRY, held('worker')).flatMap((g) => g.items.map((i) => i.href));
    expect(shown).toContain('/alerts');
  });

  it('keeps the unheaded group first, where the reflexes are', () => {
    const groups = buildNav(POULTRY, held('owner'));
    expect(groups[0].heading).toBeNull();
    expect(groups[0].items[0].href).toBe('/daily');
  });
});

describe('the words come from the species, not from poultry', () => {
  it('says Birds, Flocks and Eggs on this farm', () => {
    const groups = buildNav(POULTRY, held('owner'));
    const birds = groups.find((g) => g.heading === 'Birds');
    expect(birds).toBeDefined();
    expect(birds!.items.map((i) => i.label)).toContain('Flocks');
    expect(birds!.items.map((i) => i.label)).toContain('Eggs');
  });

  it('says Pigs, Herds and Piglets on a piggery, with no screen edited', () => {
    const pigs = terminologyFrom({
      animal: 'Pig',
      animalGroup: 'Herd',
      productionUnit: 'Pen',
      production: 'Piglets',
    });
    const groups = buildNav(pigs, held('owner'));
    const group = groups.find((g) => g.heading === 'Pigs');
    expect(group).toBeDefined();
    expect(group!.items.map((i) => i.label)).toContain('Herds');
    expect(group!.items.map((i) => i.label)).toContain('Piglets');
  });

  /**
   * The default is awkward ON PURPOSE. A poultry-shaped fallback would let a
   * missing species profile go unnoticed for months and would quietly put the
   * assumption back that this module exists to remove.
   */
  it('falls back to generic words, never to poultry ones', () => {
    const groups = buildNav(DEFAULT_TERMINOLOGY, held('owner'));
    const headings = groups.map((g) => g.heading);
    expect(headings).toContain('Animals');
    expect(headings).not.toContain('Birds');

    const labels = groups.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).not.toContain('Eggs');
    expect(labels).not.toContain('Flocks');
  });
});

describe('marking where you are', () => {
  const groups = buildNav(POULTRY, held('owner'));

  it('marks the screen you are on', () => {
    expect(currentHref('/flocks', groups)).toBe('/flocks');
  });

  it('stays marked on a screen beneath it', () => {
    expect(currentHref('/flocks/abc-123/weights', groups)).toBe('/flocks');
  });

  /**
   * Longest match, not first match. `/settings/breeds` must light up Settings,
   * and must never light up something that merely shares a prefix.
   */
  it('prefers the longest match', () => {
    expect(currentHref('/settings/breeds', groups)).toBe('/settings');
  });

  it('does not mark a half-matched path', () => {
    // '/dailyrecord' is not '/daily' — a prefix is only a match at a boundary.
    expect(currentHref('/dailyrecord', groups)).toBeNull();
  });

  it('marks nothing on a screen that is not in the navigation', () => {
    expect(currentHref('/somewhere-else', groups)).toBeNull();
  });
});
