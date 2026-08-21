import { describe, it, expect } from 'vitest';
import {
  hasFullSiteAccess,
  canAccessSite,
  siteFilter,
  siteIdFilter,
  nestedSiteFilter,
  orgFilter,
} from '../scope';
import type { Principal } from '../rbac';

const principal = (siteScope: string[]): Principal => ({
  userId: 'u1',
  organisationId: 'org1',
  roles: ['supervisor'],
  siteScope,
});

describe('site scoping', () => {
  it('treats an EMPTY scope as unrestricted — the owner', () => {
    // This inversion is the whole risk of the design, so it is asserted first.
    const owner = principal([]);
    expect(hasFullSiteAccess(owner)).toBe(true);
    expect(canAccessSite(owner, 'any-site-at-all')).toBe(true);
  });

  it('restricts a scoped principal to exactly their sites', () => {
    const p = principal(['site-a', 'site-b']);
    expect(hasFullSiteAccess(p)).toBe(false);
    expect(canAccessSite(p, 'site-a')).toBe(true);
    expect(canAccessSite(p, 'site-b')).toBe(true);
    expect(canAccessSite(p, 'site-c')).toBe(false);
  });

  describe('query filters', () => {
    it('adds no restriction for the owner, so queries return everything', () => {
      const owner = principal([]);
      expect(siteFilter(owner)).toEqual({});
      expect(siteIdFilter(owner)).toEqual({});
      expect(nestedSiteFilter(owner)).toEqual({});
    });

    it('builds an IN clause for a scoped principal', () => {
      const p = principal(['site-a', 'site-b']);
      expect(siteFilter(p)).toEqual({ siteId: { in: ['site-a', 'site-b'] } });
      expect(siteIdFilter(p)).toEqual({ id: { in: ['site-a', 'site-b'] } });
      expect(nestedSiteFilter(p)).toEqual({ site: { id: { in: ['site-a', 'site-b'] } } });
    });

    it('produces a filter that cannot match anything when scope is a single unknown site', () => {
      const p = principal(['site-z']);
      const filter = siteFilter(p);
      expect(filter.siteId?.in).toEqual(['site-z']);
      expect(filter.siteId?.in).not.toContain('site-a');
    });

    it('always constrains by organisation', () => {
      expect(orgFilter(principal([]))).toEqual({ organisationId: 'org1' });
      expect(orgFilter(principal(['site-a']))).toEqual({ organisationId: 'org1' });
    });
  });

  it('scope is independent of role — a scoped owner is still scoped', () => {
    const scopedOwner: Principal = {
      userId: 'u2',
      organisationId: 'org1',
      roles: ['owner'],
      siteScope: ['site-a'],
    };
    expect(canAccessSite(scopedOwner, 'site-b')).toBe(false);
    expect(siteFilter(scopedOwner)).toEqual({ siteId: { in: ['site-a'] } });
  });
});
