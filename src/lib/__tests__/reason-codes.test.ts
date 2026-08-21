import { describe, it, expect } from 'vitest';
import {
  REASON_CODES,
  reasonCodesFor,
  reasonLabel,
  isValidReason,
  EVENT_LABELS,
} from '../reason-codes';
import type { AnimalGroupEventType } from '../ledger';

describe('reason codes', () => {
  it('offers codes appropriate to each event type', () => {
    const mortality = reasonCodesFor('MORTALITY').map((c) => c.key);
    expect(mortality).toContain('disease');
    expect(mortality).toContain('heat_stress');
    expect(mortality).toContain('unknown');
    // Culling is a decision, not something that happened to you.
    expect(mortality).not.toContain('non_productive');
  });

  it('keeps cull reasons separate from mortality reasons', () => {
    const cull = reasonCodesFor('CULL').map((c) => c.key);
    expect(cull).toContain('non_productive');
    expect(cull).toContain('poor_condition');
    expect(cull).not.toContain('predation');
  });

  it('rejects a reason used with the wrong event type', () => {
    expect(isValidReason('predation', 'MORTALITY')).toBe(true);
    expect(isValidReason('predation', 'CULL')).toBe(false);
    expect(isValidReason('recount', 'ADJUSTMENT')).toBe(true);
    expect(isValidReason('recount', 'MORTALITY')).toBe(false);
    expect(isValidReason('not_a_real_code', 'MORTALITY')).toBe(false);
  });

  it('requires every adjustment reason to explain a correction', () => {
    const adjustment = reasonCodesFor('ADJUSTMENT');
    expect(adjustment.length).toBeGreaterThan(0);
    for (const code of adjustment) {
      expect(code.appliesTo).toContain('ADJUSTMENT');
    }
  });

  it('has unique keys', () => {
    const keys = REASON_CODES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every code at least one applicable event type', () => {
    for (const code of REASON_CODES) {
      expect(code.appliesTo.length).toBeGreaterThan(0);
    }
  });

  it('falls back to the raw key rather than hiding an unknown code', () => {
    // Historic data may hold a code that has since been retired. Showing the raw
    // value is honest; showing "—" would silently erase it.
    expect(reasonLabel('disease')).toBe('Disease / suspected disease');
    expect(reasonLabel('some_retired_code')).toBe('some_retired_code');
    expect(reasonLabel(null)).toBe('—');
    expect(reasonLabel(undefined)).toBe('—');
  });

  it('labels every event type', () => {
    const types: AnimalGroupEventType[] = [
      'PLACEMENT',
      'MORTALITY',
      'CULL',
      'SALE',
      'TRANSFER_IN',
      'TRANSFER_OUT',
      'ADJUSTMENT',
      'STAGE_CHANGE',
    ];
    for (const type of types) {
      expect(EVENT_LABELS[type]).toBeTruthy();
    }
  });

  it('includes "unknown" for mortality — guessing a cause is worse', () => {
    expect(isValidReason('unknown', 'MORTALITY')).toBe(true);
  });
});
