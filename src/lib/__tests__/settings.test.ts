import { describe, it, expect } from 'vitest';
import { organisationSchema, breedSchema } from '../validation/site';
import { coverUrgency } from '../stock-cover';

describe('organisation settings', () => {
  const form = (over: Record<string, string> = {}) => ({
    name: 'ADRAH Farms',
    legalName: '',
    ...over,
  });

  it('accepts a lead time in days', () => {
    const r = organisationSchema.safeParse(form({ stockLeadTimeDays: '14' }));
    expect(r.success && r.data.stockLeadTimeDays).toBe(14);
  });

  it('falls back to the documented default when the field is absent', () => {
    const r = organisationSchema.safeParse(form());
    expect(r.success && r.data.stockLeadTimeDays).toBe(7);
  });

  it('accepts a next-day supplier', () => {
    expect(organisationSchema.safeParse(form({ stockLeadTimeDays: '1' })).success).toBe(true);
  });

  it('refuses a fractional or absurd lead time', () => {
    expect(organisationSchema.safeParse(form({ stockLeadTimeDays: '2.5' })).success).toBe(false);
    expect(organisationSchema.safeParse(form({ stockLeadTimeDays: '400' })).success).toBe(false);
    expect(organisationSchema.safeParse(form({ stockLeadTimeDays: '-1' })).success).toBe(false);
  });
});

describe("ADRAH's own lead time changes what counts as safe", () => {
  /**
   * The farm orders feed a fortnight ahead. The same stock figure that would be
   * comfortable for a next-day supplier is an emergency here — which is exactly
   * why the threshold is a setting and not a constant.
   */
  const ADRAH = 14;

  it('makes 9.6 days of cover CRITICAL, not comfortable', () => {
    expect(coverUrgency(9.6, ADRAH)).toBe('CRITICAL');
    expect(coverUrgency(9.6, 1)).toBe('OK');
  });

  it('starts warning a full month out', () => {
    expect(coverUrgency(20, ADRAH)).toBe('LOW');
    expect(coverUrgency(30, ADRAH)).toBe('OK');
  });

  it('is critical right up to the lead time itself', () => {
    expect(coverUrgency(13.9, ADRAH)).toBe('CRITICAL');
    expect(coverUrgency(14, ADRAH)).toBe('LOW');
  });
});

describe('adding a breed', () => {
  it('accepts a name and breeder', () => {
    const r = breedSchema.safeParse({ name: 'Shaver Brown', supplier: 'Hendrix Genetics' });
    expect(r.success && r.data.name).toBe('Shaver Brown');
  });

  it('requires a name', () => {
    expect(breedSchema.safeParse({ name: '', supplier: '' }).success).toBe(false);
  });

  it('treats a blank breeder as absent rather than empty', () => {
    const r = breedSchema.safeParse({ name: 'Shaver Brown', supplier: '' });
    expect(r.success && r.data.supplier).toBeUndefined();
  });
});
