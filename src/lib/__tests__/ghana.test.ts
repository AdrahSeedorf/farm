import { describe, it, expect } from 'vitest';
import {
  GHANA_REGIONS,
  isGhanaRegion,
  toE164,
  formatGhanaPhone,
  whatsappLink,
  telLink,
} from '../ghana';

describe('regions', () => {
  it('carries all sixteen', () => {
    expect(GHANA_REGIONS).toHaveLength(16);
    expect(isGhanaRegion('Ashanti')).toBe(true);
    expect(isGhanaRegion('Brong-Ahafo')).toBe(false); // split in 2019
  });
});

describe('phone numbers, as people actually write them', () => {
  it('READS EVERY FORM THE SAME NUMBER ARRIVES IN', () => {
    // A farm is not the place to argue about formatting.
    for (const written of [
      '024 123 4567',
      '0241234567',
      '+233241234567',
      '233 24 123 4567',
      '24 123 4567',
      '+233 (0)24-123-4567'.replace('(0)', ''),
    ]) {
      expect(toE164(written)).toBe('+233241234567');
    }
  });

  it('RETURNS NULL RATHER THAN GUESSING', () => {
    // A supplier reachable only through a number somebody wrote down wrongly is
    // still a supplier. The record keeps what was given; it just cannot offer a
    // WhatsApp link for it.
    expect(toE164('12345')).toBeNull();
    expect(toE164('not a number')).toBeNull();
    expect(toE164('')).toBeNull();
    expect(toE164(null)).toBeNull();
  });

  it('reads it back the way a Ghanaian would', () => {
    expect(formatGhanaPhone('+233241234567')).toBe('024 123 4567');
    expect(formatGhanaPhone('0241234567')).toBe('024 123 4567');
  });

  it('KEEPS AN UNREADABLE NUMBER AS TYPED rather than blanking it', () => {
    expect(formatGhanaPhone('0302 landline ext 4')).toBe('0302 landline ext 4');
  });

  it('builds a WhatsApp link, which is how a farm actually reaches a supplier', () => {
    expect(whatsappLink('024 123 4567')).toBe('https://wa.me/233241234567');
    expect(whatsappLink('nonsense')).toBeNull();
  });

  it('and a tap-to-call link', () => {
    expect(telLink('024 123 4567')).toBe('tel:+233241234567');
    expect(telLink(null)).toBeNull();
  });
});
