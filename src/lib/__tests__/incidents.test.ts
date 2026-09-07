import { describe, it, expect } from 'vitest';
import {
  INCIDENT_KINDS,
  KIND_LABELS,
  SEVERITIES,
  SEVERITY_LABELS,
  UNREVIEWED_AFTER_DAYS,
  stateOf,
  daysWaiting,
  isUnattended,
  incidentSentence,
  incidentReferenceFor,
  sequenceOf,
  reportErrors,
  personHurtNotice,
  sortIncidents,
  incidentSummary,
  type Incident,
} from '../incidents';

const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const today = at('2026-09-06');

let seq = 0;
const incident = (over: Partial<Incident> = {}): Incident => ({
  id: `i${++seq}`,
  reference: `INC-2026-000${seq}`,
  what: 'A fox took two birds from House A overnight',
  kind: null,
  siteId: 'site-a',
  siteName: 'Main Farm',
  occurredAt: at('2026-09-06'),
  reportedByName: 'Kwame',
  reportedAt: at('2026-09-06'),
  reviewedAt: null,
  reviewedByName: null,
  severity: null,
  reviewNote: null,
  closedAt: null,
  closedByName: null,
  outcome: null,
  ...over,
});

describe('THE REPORTER DESCRIBES, SOMEBODY ELSE GRADES', () => {
  it('a fresh report carries no severity at all', () => {
    // Asking the person at the fence how bad it is produces either everything
    // marked minor, because nobody wants to sound dramatic, or everything marked
    // serious, because nobody wants to be blamed for downplaying it. Neither is
    // information.
    const fresh = incident();
    expect(fresh.severity).toBeNull();
    expect(stateOf(fresh)).toBe('REPORTED');
  });

  it('and the grade arrives with the review, named', () => {
    const reviewed = incident({
      reviewedAt: at('2026-09-06'),
      reviewedByName: 'Owner',
      severity: 'NOTABLE',
    });
    expect(stateOf(reviewed)).toBe('REVIEWED');
    expect(incidentSentence(reviewed, today)).toMatch(/Looked at by Owner/);
    expect(incidentSentence(reviewed, today)).toMatch(/something was done about it/i);
  });

  it('a review that grades nothing still says so rather than implying minor', () => {
    const reviewed = incident({ reviewedAt: today, reviewedByName: 'Owner' });
    expect(incidentSentence(reviewed, today)).toMatch(/not graded/i);
  });

  it('three severities, and the middle one does real work', () => {
    expect(SEVERITIES).toEqual(['MINOR', 'NOTABLE', 'SERIOUS']);
    for (const s of SEVERITIES) expect(SEVERITY_LABELS[s].length).toBeGreaterThan(10);
  });
});

describe('a report nobody reads', () => {
  it('is the failure this module is most exposed to', () => {
    // A report nobody acknowledges teaches the person who wrote it that
    // reporting achieves nothing, and that lesson is what stops the next one.
    const old = incident({ reportedAt: at('2026-09-01') });
    expect(daysWaiting(old, today)).toBe(5);
    expect(isUnattended(old, today)).toBe(true);
    expect(incidentSentence(old, today)).toMatch(/nobody has looked at it yet/i);
  });

  it('but a report from this morning is not yet a problem', () => {
    expect(isUnattended(incident(), today)).toBe(false);
    expect(incidentSentence(incident(), today)).toMatch(/Reported today/);
  });

  it('and one already reviewed never counts as unattended', () => {
    const old = incident({ reportedAt: at('2026-08-01'), reviewedAt: at('2026-08-02') });
    expect(isUnattended(old, today)).toBe(false);
  });

  it('the threshold is short on purpose', () => {
    expect(UNREVIEWED_AFTER_DAYS).toBeLessThanOrEqual(3);
  });
});

describe('the order they are read in', () => {
  it('UNATTENDED FIRST — never by severity', () => {
    // A serious incident that has been dealt with needs less attention than a
    // minor one nobody has read. Sorting by severity buries exactly the reports
    // this module exists to surface.
    const seriousClosed = incident({
      what: 'serious-closed',
      severity: 'SERIOUS',
      reviewedAt: at('2026-09-05'),
      closedAt: at('2026-09-05'),
      closedByName: 'Owner',
      outcome: 'Fence repaired',
    });
    const minorStale = incident({ what: 'minor-stale', reportedAt: at('2026-09-01') });
    const freshReport = incident({ what: 'fresh', reportedAt: today });

    expect(
      sortIncidents([seriousClosed, freshReport, minorStale], today).map((i) => i.what),
    ).toEqual(['minor-stale', 'fresh', 'serious-closed']);
  });

  it('and within a rank, most recent first', () => {
    const older = incident({ what: 'older', occurredAt: at('2026-09-02') });
    const newer = incident({ what: 'newer', occurredAt: at('2026-09-05') });
    expect(sortIncidents([older, newer], today).map((i) => i.what)).toEqual(['newer', 'older']);
  });
});

describe('what will not be saved', () => {
  it('accepts a report with a description', () => {
    expect(reportErrors({ what: 'A fox took two birds', occurredAt: today }, today)).toEqual([]);
  });

  it('ONE REQUIRED FIELD, because every extra one lowers the count', () => {
    // The only number this module has is the proportion of incidents that get
    // reported, and that is set by how much the form asks for at half five in
    // the morning.
    expect(reportErrors({ what: 'x', occurredAt: today }, today)[0]).toMatch(
      /what happened/i,
    );
    expect(reportErrors({ what: 'A fox took two birds', occurredAt: today }, today)).toHaveLength(
      0,
    );
  });

  it('and a date in the future, which is a typo rather than a report', () => {
    expect(reportErrors({ what: 'Something', occurredAt: at('2027-01-01') }, today)[0]).toMatch(
      /in the future/i,
    );
  });
});

describe('somebody being hurt', () => {
  it('GETS OUT OF THE WAY RATHER THAN GIVING A PROCEDURE', () => {
    // This software does not know what first aid this farm has, who is trained,
    // or what the law requires. A confident list of steps would be worse than
    // nothing, because somebody might follow it.
    const notice = personHurtNotice('PERSON_HURT')!;
    expect(notice).toMatch(/deal with that first/i);
    expect(notice).toMatch(/nothing here is a substitute for getting them help/i);
    expect(notice).not.toMatch(/step 1|first aid kit|call \d/i);
  });

  it('and says nothing at all for anything else', () => {
    expect(personHurtNotice('PREDATOR')).toBeNull();
    expect(personHurtNotice(null)).toBeNull();
  });
});

describe('the reference on the record', () => {
  it('reads out over a phone', () => {
    expect(incidentReferenceFor(2026, 7)).toBe('INC-2026-0007');
    expect(sequenceOf('INC-2026-0007', 2026)).toBe(7);
  });

  it('and ignores one from another year', () => {
    expect(sequenceOf('INC-2025-0099', 2026)).toBe(0);
    expect(sequenceOf('', 2026)).toBe(0);
  });
});

describe('the line at the top', () => {
  it('LEADS WITH WHAT NOBODY HAS READ', () => {
    const tasks = [incident({ reportedAt: at('2026-09-01') }), incident()];
    expect(incidentSummary(tasks, today)).toMatch(/1 report nobody has looked at/);
  });

  it('then with what is merely waiting', () => {
    expect(incidentSummary([incident()], today)).toBe('1 waiting to be looked at.');
  });

  it('and says so plainly when everything is dealt with', () => {
    expect(incidentSummary([], today)).toBe('Nothing reported.');
    expect(
      incidentSummary([incident({ reviewedAt: today, reviewedByName: 'Owner' })], today),
    ).toMatch(/has been looked at/);
  });
});

describe('the category list', () => {
  it('is short, fixed, and has an escape hatch', () => {
    // A taxonomy this small is a setting nobody would edit, and one that people
    // DO edit stops being comparable across the year it was edited in — which
    // destroys the only thing categories are for.
    expect(INCIDENT_KINDS).toContain('OTHER');
    expect(INCIDENT_KINDS.length).toBeLessThanOrEqual(10);
    for (const k of INCIDENT_KINDS) expect(KIND_LABELS[k].length).toBeGreaterThan(0);
  });

  it('and is optional on a report', () => {
    expect(incident().kind).toBeNull();
    expect(reportErrors({ what: 'Something happened', occurredAt: today }, today)).toEqual([]);
  });
});
