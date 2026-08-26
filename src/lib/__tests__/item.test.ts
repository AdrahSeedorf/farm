import { describe, it, expect } from 'vitest';
import {
  itemSchema,
  stockLocationSchema,
  deriveSku,
  unitChangeAllowed,
  CATEGORY_META,
  ITEM_CATEGORIES,
} from '../validation/item';
import { getUnit, toBase } from '../uom';
import { stockStatus } from '../stock-ledger';

const form = (over: Record<string, string> = {}) => ({
  name: 'Layer mash',
  category: 'FEED',
  stockUomKey: 'bag_50kg',
  sku: '',
  reorderLevel: '',
  minimumStock: '',
  ...over,
});

describe('deriving an item code', () => {
  it('builds one from the name so nobody has to invent it', () => {
    expect(deriveSku('Layer mash', 'FEED')).toBe('FD-LAYER-MASH');
    expect(deriveSku('Newcastle (La Sota)', 'VACCINE')).toBe('VX-NEWCASTLE-LA');
  });

  it('truncates at a word boundary rather than through one', () => {
    // "VX-NEWCASTLE-LA-SOT" is a code nobody reads aloud correctly.
    expect(deriveSku('Newcastle La Sota Clone', 'VACCINE')).toBe('VX-NEWCASTLE-LA');
    expect(deriveSku('Chick starter mash premium', 'FEED')).toBe('FD-CHICK-STARTER');
  });

  it('strips punctuation rather than passing it into a reference code', () => {
    expect(deriveSku('  Diesel / 50ppm  ', 'FUEL')).toBe('FU-DIESEL-50PPM');
  });

  it('never ends in a stray hyphen', () => {
    expect(deriveSku('Egg crates!!!', 'PACKAGING')).not.toMatch(/-$/);
  });

  it('falls back to the category alone rather than producing an empty code', () => {
    expect(deriveSku('!!!', 'OTHER')).toBe('GN');
  });
});

describe('item validation', () => {
  it('accepts a minimal item', () => {
    const r = itemSchema.safeParse(form());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sku).toBeNull(); // derived by the action
      expect(r.data.reorderLevel).toBeNull();
      expect(r.data.isPerishable).toBe(false);
    }
  });

  it('reads a ticked checkbox', () => {
    const r = itemSchema.safeParse(form({ isPerishable: 'on' }));
    expect(r.success && r.data.isPerishable).toBe(true);
  });

  it('BLANK IS NOT ZERO — no threshold means no alert, not "alert at empty"', () => {
    const r = itemSchema.safeParse(form({ reorderLevel: '' }));
    expect(r.success && r.data.reorderLevel).toBeNull();

    const zero = itemSchema.safeParse(form({ reorderLevel: '0' }));
    expect(zero.success && zero.data.reorderLevel).toBe(0);
  });

  it('rejects a reorder level below the minimum, which would never fire first', () => {
    const r = itemSchema.safeParse(form({ reorderLevel: '2', minimumStock: '5' }));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toEqual(['reorderLevel']);
    }
  });

  it('allows both thresholds to be equal', () => {
    expect(itemSchema.safeParse(form({ reorderLevel: '5', minimumStock: '5' })).success).toBe(true);
  });

  it('uppercases a typed code and refuses spaces and slashes', () => {
    const ok = itemSchema.safeParse(form({ sku: 'fd-mash-1' }));
    expect(ok.success && ok.data.sku).toBe('FD-MASH-1');
    expect(itemSchema.safeParse(form({ sku: 'FD MASH/1' })).success).toBe(false);
  });

  it('refuses an unknown category rather than storing it as OTHER', () => {
    expect(itemSchema.safeParse(form({ category: 'LIVESTOCK' })).success).toBe(false);
  });

  it('demands a unit — a quantity without one means nothing', () => {
    expect(itemSchema.safeParse(form({ stockUomKey: '' })).success).toBe(false);
  });
});

describe('category defaults', () => {
  it('describes every category', () => {
    for (const key of ITEM_CATEGORIES) {
      expect(CATEGORY_META[key].label.length).toBeGreaterThan(0);
      expect(CATEGORY_META[key].suggestedUnits.length).toBeGreaterThan(0);
    }
  });

  it('suggests only units that actually exist', () => {
    for (const key of ITEM_CATEGORIES) {
      for (const unitKey of CATEGORY_META[key].suggestedUnits) {
        expect(() => getUnit(unitKey)).not.toThrow();
      }
    }
  });

  it('suggests doses for vaccines, not pieces', () => {
    expect(CATEGORY_META.VACCINE.suggestedUnits).toContain('dose');
  });

  it('marks vaccines and feed as expiring by default', () => {
    expect(CATEGORY_META.VACCINE.perishableByDefault).toBe(true);
    expect(CATEGORY_META.FEED.perishableByDefault).toBe(true);
    expect(CATEGORY_META.EQUIPMENT.perishableByDefault).toBe(false);
  });
});

describe('changing an item unit', () => {
  it('allows any change while the item has no history', () => {
    expect(unitChangeAllowed('MASS', 'VOLUME', 0).allowed).toBe(true);
  });

  it('allows a change within the same dimension at any time', () => {
    // bag -> kg is only a display preference; stock is stored in kg either way.
    expect(unitChangeAllowed('MASS', 'MASS', 400).allowed).toBe(true);
  });

  it('refuses a cross-dimension change once movements exist', () => {
    const r = unitChangeAllowed('MASS', 'VOLUME', 3);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/3 recorded movement/);
  });
});

describe('thresholds are stored in the base unit', () => {
  /**
   * The bug this guards against: a reorder level of "4" entered as bags being
   * compared against an on-hand figure of 200, which is kilograms. Both are
   * plausible numbers, so nothing looks broken — the alert simply never fires.
   */
  it('converts an entered threshold before it is compared with stock', () => {
    const entered = 4; // bags
    const stored = toBase(entered, 'bag_50kg'); // 200 kg
    expect(stored).toBe(200);

    const onHand = 150; // kg in the store
    expect(stockStatus(onHand, stored, null)).toBe('LOW');
    // Comparing the raw entry instead would have said everything was fine.
    expect(stockStatus(onHand, entered, null)).toBe('OK');
  });
});

describe('stock location validation', () => {
  it('accepts a store', () => {
    const r = stockLocationSchema.safeParse({ siteId: 'abc', name: 'Feed store', code: 'feed' });
    expect(r.success && r.data.code).toBe('FEED');
  });

  it('requires a farm — a store has to sit somewhere', () => {
    expect(
      stockLocationSchema.safeParse({ siteId: '', name: 'Feed store', code: 'FEED' }).success,
    ).toBe(false);
  });
});
