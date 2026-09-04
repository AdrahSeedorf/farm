import { describe, it, expect } from 'vitest';
import {
  batchNumberFor,
  expiryFor,
  dispositionStocks,
  planProductionStock,
  stockNote,
  reverseOf,
  PRODUCE_ENTERS_UNCOSTED,
  type StockableGrade,
  type PlanInput,
} from '../production-stock';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const large: StockableGrade = {
  gradeId: 'g-large',
  gradeName: 'Large',
  itemId: 'item-large',
  itemName: 'Eggs — large',
  itemBaseUnit: 'piece',
  itemIsActive: true,
  shelfLifeDays: 21,
};

const cracked: StockableGrade = {
  gradeId: 'g-cracked',
  gradeName: 'Cracked',
  itemId: null,
  itemName: null,
  itemBaseUnit: null,
  itemIsActive: true,
  shelfLifeDays: null,
};

const medium: StockableGrade = {
  gradeId: 'g-medium',
  gradeName: 'Medium',
  itemId: 'item-medium',
  itemName: 'Eggs — medium',
  itemBaseUnit: 'piece',
  itemIsActive: true,
  shelfLifeDays: 21,
};

const base: PlanInput = {
  flockCode: 'FLK-2026-01',
  onDate: d('2026-09-04'),
  disposition: 'SALEABLE',
  lines: [
    { gradeId: 'g-large', quantityBase: 240 },
    { gradeId: 'g-medium', quantityBase: 90 },
    { gradeId: 'g-cracked', quantityBase: 12 },
  ],
  grades: [large, medium, cracked],
  store: { id: 'store-1', name: 'Egg room' },
};

describe('the batch a day’s produce goes into', () => {
  it('is named for the flock and the day', () => {
    expect(batchNumberFor('FLK-2026-01', d('2026-09-04'))).toBe('FLK-2026-01-2026-09-04');
  });

  it('IS THE SAME FOR EVERY COLLECTION OF THAT DAY', () => {
    // The morning and evening walks of one house produce eggs of the same age
    // from the same birds. Two batches would be two rows saying one thing.
    expect(batchNumberFor('FLK-2026-01', d('2026-09-04'))).toBe(
      batchNumberFor('FLK-2026-01', d('2026-09-04')),
    );
  });

  it('differs between flocks on the same day', () => {
    expect(batchNumberFor('FLK-A', d('2026-09-04'))).not.toBe(
      batchNumberFor('FLK-B', d('2026-09-04')),
    );
  });

  it('dates the expiry from the shelf life', () => {
    expect(expiryFor(d('2026-09-04'), 21)?.toISOString().slice(0, 10)).toBe('2026-09-25');
  });

  it('REPORTS NO EXPIRY RATHER THAN GUESSING ONE', () => {
    // How long an egg keeps depends on washing, storage and heat. None of that
    // is knowable here, and a guessed date would be trusted.
    expect(expiryFor(d('2026-09-04'), null)).toBeNull();
    expect(expiryFor(d('2026-09-04'), 0)).toBeNull();
    expect(expiryFor(d('2026-09-04'), -3)).toBeNull();
  });

  it('does not put a cost on an egg', () => {
    // Documented at length in the module: the month's wages are not allocated
    // yet, so any figure written on the day would be wrong and would become
    // the farm's official one.
    expect(PRODUCE_ENTERS_UNCOSTED).toBe(true);
  });
});

describe('what becomes stock', () => {
  it('plans a movement for every grade held as an item', () => {
    const plan = planProductionStock(base);
    expect(plan.status).toBe('planned');
    if (plan.status !== 'planned') return;

    expect(plan.lines.map((l) => l.itemId)).toEqual(['item-large', 'item-medium']);
    expect(plan.lines.map((l) => l.quantityBase)).toEqual([240, 90]);
    expect(plan.storeName).toBe('Egg room');
    expect(plan.batchNumber).toBe('FLK-2026-01-2026-09-04');
    expect(plan.expiresOn?.toISOString().slice(0, 10)).toBe('2026-09-25');
  });

  it('LEAVES OUT A GRADE NOBODY HOLDS AS STOCK, without complaint', () => {
    // Cracked eggs are collected, counted and graded. They are simply never
    // something the store says it has.
    const plan = planProductionStock(base);
    if (plan.status !== 'planned') throw new Error('expected a plan');
    expect(plan.lines.find((l) => l.gradeId === 'g-cracked')).toBeUndefined();
    expect(plan.lines).toHaveLength(2);
  });

  it('carries the item’s own unit, not the grade’s name for it', () => {
    const plan = planProductionStock(base);
    if (plan.status !== 'planned') throw new Error('expected a plan');
    expect(plan.lines[0].unitKey).toBe('piece');
  });

  it('writes nothing for a zero or negative line', () => {
    const plan = planProductionStock({
      ...base,
      lines: [
        { gradeId: 'g-large', quantityBase: 0 },
        { gradeId: 'g-medium', quantityBase: 90 },
      ],
    });
    if (plan.status !== 'planned') throw new Error('expected a plan');
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0].itemId).toBe('item-medium');
  });
});

describe('when nothing goes into the store', () => {
  it('ONLY SALEABLE PRODUCE BECOMES STOCK', () => {
    // Held eggs in the same item as sellable ones are indistinguishable from
    // them, and the first consequence of that is somebody selling them.
    expect(dispositionStocks('SALEABLE')).toBe(true);
    expect(dispositionStocks('HELD')).toBe(false);
    expect(dispositionStocks('DISCARDED')).toBe(false);
    expect(dispositionStocks('HOME_USE')).toBe(false);
  });

  it('says a held collection was held, not that nothing happened', () => {
    const plan = planProductionStock({ ...base, disposition: 'HELD' });
    expect(plan.status).toBe('none');
    if (plan.status !== 'none') return;
    expect(plan.reason).toMatch(/held back/i);
    expect(plan.reason).toMatch(/recorded/i);
  });

  it('distinguishes destroyed from used on the farm', () => {
    const destroyed = planProductionStock({ ...base, disposition: 'DISCARDED' });
    const home = planProductionStock({ ...base, disposition: 'HOME_USE' });
    if (destroyed.status !== 'none' || home.status !== 'none') throw new Error('expected none');
    expect(destroyed.reason).toMatch(/destroyed/i);
    expect(home.reason).toMatch(/used on the farm/i);
  });

  it('NAMES WHAT TO DO when no store is set to receive produce', () => {
    const plan = planProductionStock({ ...base, store: null });
    if (plan.status !== 'none') throw new Error('expected none');
    expect(plan.reason).toMatch(/no store at this farm/i);
    expect(plan.reason).toMatch(/Store → Stores/);
  });

  it('names what to do when no grade is linked to an item', () => {
    const plan = planProductionStock({
      ...base,
      lines: [{ gradeId: 'g-cracked', quantityBase: 12 }],
      grades: [cracked],
    });
    if (plan.status !== 'none') throw new Error('expected none');
    expect(plan.reason).toMatch(/none of these grades is held as stock/i);
    expect(plan.reason).toMatch(/Settings → Grades/);
  });

  it('SAYS SO when the store item has been archived', () => {
    // Silently dropping this would leave the collection and the store
    // disagreeing with nobody told why.
    const plan = planProductionStock({
      ...base,
      lines: [{ gradeId: 'g-large', quantityBase: 240 }],
      grades: [{ ...large, itemIsActive: false }],
    });
    if (plan.status !== 'none') throw new Error('expected none');
    expect(plan.reason).toMatch(/archived/i);
    expect(plan.reason).toMatch(/Large/);
    expect(plan.reason).toMatch(/recorded in full/i);
  });

  it('never throws, whatever it is given', () => {
    expect(() =>
      planProductionStock({ ...base, lines: [], grades: [], store: null }),
    ).not.toThrow();
  });
});

describe('what the screen says afterwards', () => {
  it('names the total, the store and the date', () => {
    const note = stockNote(planProductionStock(base), 'Eggs');
    expect(note).toMatch(/330 added to Egg room/);
    expect(note).toMatch(/best before 2026-09-25/);
  });

  it('names the item when only one grade is stocked', () => {
    const plan = planProductionStock({
      ...base,
      lines: [{ gradeId: 'g-large', quantityBase: 240 }],
    });
    expect(stockNote(plan, 'Eggs')).toMatch(/as Eggs — large/);
  });

  it('leaves out a best-before it does not have', () => {
    const plan = planProductionStock({
      ...base,
      lines: [{ gradeId: 'g-large', quantityBase: 240 }],
      grades: [{ ...large, shelfLifeDays: null }],
    });
    expect(stockNote(plan)).not.toMatch(/best before/);
  });

  it('SAYS SOMETHING EVEN WHEN NOTHING WENT IN', () => {
    // Otherwise a person cannot tell "it went into the store" from "it silently
    // did not".
    const note = stockNote(planProductionStock({ ...base, store: null }));
    expect(note.length).toBeGreaterThan(20);
  });
});

describe('taking it back out after a correction', () => {
  const posted = [
    { itemId: 'item-large', itemBatchId: 'b1', stockLocationId: 's1', deltaBase: 240, unitKey: 'piece' },
    { itemId: 'item-medium', itemBatchId: 'b2', stockLocationId: 's1', deltaBase: 90, unitKey: 'piece' },
  ];

  it('MIRRORS WHAT ACTUALLY WENT IN, rather than recomputing it', () => {
    // A grade unlinked since, or a shelf life changed since, would make a fresh
    // calculation disagree with what is sitting in the store.
    expect(reverseOf(posted).map((m) => m.deltaBase)).toEqual([-240, -90]);
  });

  it('takes it out of the same batch it went into', () => {
    expect(reverseOf(posted).map((m) => m.itemBatchId)).toEqual(['b1', 'b2']);
  });

  it('cancels exactly', () => {
    const net = [...posted, ...reverseOf(posted)].reduce((s, m) => s + m.deltaBase, 0);
    expect(net).toBe(0);
  });

  it('ignores a movement of nothing', () => {
    expect(
      reverseOf([{ ...posted[0], deltaBase: 0 }]),
    ).toEqual([]);
  });
});
