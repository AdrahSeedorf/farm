import { describe, it, expect } from 'vitest';
import { terminologyFrom, lower, DEFAULT_TERMINOLOGY } from '../terminology';

/** Exactly what `prisma/seed.ts` writes onto the poultry species profile. */
const poultry = {
  animal: 'Bird',
  animalGroup: 'Flock',
  productionUnit: 'House',
  production: 'Eggs',
};

describe('the words a screen uses', () => {
  it('comes from the species profile', () => {
    const t = terminologyFrom(poultry);
    expect(t.animal).toBe('Bird');
    expect(t.animalGroup).toBe('Flock');
    expect(t.productionUnit).toBe('House');
    expect(t.production).toBe('Eggs');
  });

  it('derives the plurals nobody should have to type', () => {
    const t = terminologyFrom(poultry);
    expect(t.animalPlural).toBe('Birds');
    expect(t.animalGroupPlural).toBe('Flocks');
    expect(t.productionUnitPlural).toBe('Houses');
  });

  it('derives the singular of the produce', () => {
    expect(terminologyFrom(poultry).productionSingular).toBe('Egg');
  });

  it('lets a species that does not follow the rule state its own words', () => {
    const t = terminologyFrom({
      animal: 'Cow',
      animalPlural: 'Cattle',
      animalGroup: 'Herd',
      productionUnit: 'Paddock',
      production: 'Milk',
      productionSingular: 'Litre',
    });
    expect(t.animalPlural).toBe('Cattle');
    expect(t.productionSingular).toBe('Litre');
  });

  it('leaves a produce with no plural "s" alone rather than trimming a letter', () => {
    expect(terminologyFrom({ production: 'Milk' }).productionSingular).toBe('Milk');
  });
});

describe('a species profile with nothing configured', () => {
  it('reads generically, so a missing map is visible rather than assumed', () => {
    // NOT "Flock" and NOT "Egg". A poultry-shaped default would hide the gap and
    // quietly put the assumption back that this module exists to remove.
    expect(terminologyFrom(null)).toEqual(DEFAULT_TERMINOLOGY);
    expect(terminologyFrom(undefined).animalGroup).toBe('Group');
    expect(terminologyFrom('Flock').productionUnit).toBe('Unit');
    expect(terminologyFrom({}).production).toBe('Output');
  });

  it('falls back word by word, keeping whatever was configured', () => {
    const t = terminologyFrom({ animalGroup: 'Flock' });
    expect(t.animalGroup).toBe('Flock');
    expect(t.animalGroupPlural).toBe('Flocks');
    expect(t.productionUnit).toBe('Unit');
  });

  it('treats a blank string as nothing configured', () => {
    expect(terminologyFrom({ animalGroup: '   ' }).animalGroup).toBe('Group');
  });

  it('ignores a value that is not a word', () => {
    expect(terminologyFrom({ animal: 42 }).animal).toBe('Animal');
  });
});

describe('the same word mid-sentence', () => {
  it('lower-cases for prose', () => {
    expect(lower('Eggs')).toBe('eggs');
    expect(lower('House')).toBe('house');
  });
});
